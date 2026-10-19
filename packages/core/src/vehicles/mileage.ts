// RG-M02-09, RG-M02-10, RG-M02-11 — kilométrage moyen et estimation du jour.

export type VehicleUsage = "PRIVATE" | "TAXI" | "TRANSPORT" | "UTILITY" | "RENTAL" | "OTHER";

export interface MileageReadingLike {
  mileage: number;
  readAt: Date;
  isOutlier?: boolean;
}

/** RG-M02-10 — valeurs par défaut par usage (paramétrables dans M15). OTHER retombe sur PRIVATE. */
export const DEFAULT_AVG_KM_PER_DAY: Record<VehicleUsage, number> = {
  PRIVATE: 35,
  TAXI: 220,
  TRANSPORT: 250,
  UTILITY: 90,
  RENTAL: 120,
  OTHER: 35,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WINDOW_MONTHS = 18;
const RECENT_MONTHS = 6;
const MIN_SPAN_DAYS = 14;
const MIN_RATE = 0;
const MAX_RATE = 800;
const MIN_AGE_DAYS_SINGLE_READING = 180;

function monthsAgo(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() - months);
  return result;
}

export type AvgKmPerDaySource = "REGRESSION" | "SINGLE_READING" | "DEFAULT";

export interface AvgKmPerDayResult {
  avgKmPerDay: number;
  source: AvgKmPerDaySource;
}

/**
 * RG-M02-10 — régression linéaire pondérée (×2 pour les 6 derniers mois) sur les relevés
 * des 18 derniers mois, bornée à [0 ; 800]. À défaut de données suffisantes, utilise le
 * kilométrage/âge pour un relevé unique (véhicule ≥ 180 j), sinon la valeur par défaut de l'usage.
 */
export function computeAvgKmPerDay(
  readings: readonly MileageReadingLike[],
  usage: VehicleUsage,
  today: Date,
  firstRegistrationDate?: Date | null,
): AvgKmPerDayResult {
  const windowStart = monthsAgo(today, WINDOW_MONTHS);
  const eligible = readings
    .filter((r) => !r.isOutlier && r.readAt >= windowStart && r.readAt <= today)
    .slice()
    .sort((a, b) => a.readAt.getTime() - b.readAt.getTime());

  if (eligible.length >= 2) {
    const first = eligible[0]!;
    const last = eligible[eligible.length - 1]!;
    const spanMs = last.readAt.getTime() - first.readAt.getTime();
    if (spanMs >= MIN_SPAN_DAYS * MS_PER_DAY) {
      const recentStart = monthsAgo(today, RECENT_MONTHS);
      const originMs = first.readAt.getTime();
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxy = 0;
      let sxx = 0;
      for (const reading of eligible) {
        const x = (reading.readAt.getTime() - originMs) / MS_PER_DAY;
        const y = reading.mileage;
        const w = reading.readAt >= recentStart ? 2 : 1;
        sw += w;
        sx += w * x;
        sy += w * y;
        sxy += w * x * y;
        sxx += w * x * x;
      }
      const denominator = sw * sxx - sx * sx;
      if (denominator !== 0) {
        const slope = (sw * sxy - sx * sy) / denominator;
        return { avgKmPerDay: clamp(slope, MIN_RATE, MAX_RATE), source: "REGRESSION" };
      }
    }
  }

  if (eligible.length === 1 && firstRegistrationDate) {
    const ageDays = (today.getTime() - firstRegistrationDate.getTime()) / MS_PER_DAY;
    if (ageDays >= MIN_AGE_DAYS_SINGLE_READING) {
      const rate = eligible[0]!.mileage / ageDays;
      return { avgKmPerDay: clamp(rate, MIN_RATE, MAX_RATE), source: "SINGLE_READING" };
    }
  }

  return { avgKmPerDay: DEFAULT_AVG_KM_PER_DAY[usage], source: "DEFAULT" };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** RG-M02-11 — kilométrage estimé du jour. `odometerOffset` cumule les remplacements de compteur (RG-M02-09). */
export function estimateMileage(
  currentMileage: number,
  avgKmPerDay: number,
  currentMileageAt: Date,
  today: Date,
  odometerOffset = 0,
): number {
  const daysElapsed = Math.max(0, (today.getTime() - currentMileageAt.getTime()) / MS_PER_DAY);
  return currentMileage + odometerOffset + Math.round(avgKmPerDay * daysElapsed);
}
