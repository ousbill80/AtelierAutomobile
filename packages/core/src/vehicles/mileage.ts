export type VehicleUsage = "PRIVATE" | "TAXI" | "TRANSPORT" | "UTILITY" | "RENTAL" | "OTHER";

/** RG-M02-10 — valeur par défaut (km/j) utilisée quand aucun calcul n'est possible, par usage. */
export const DEFAULT_AVG_KM_PER_DAY: Record<VehicleUsage, number> = {
  PRIVATE: 35,
  TAXI: 220,
  TRANSPORT: 250,
  UTILITY: 90,
  RENTAL: 120,
  OTHER: 35,
};

const MIN_AVG_KM_PER_DAY = 0;
const MAX_AVG_KM_PER_DAY = 800;
const MIN_READING_GAP_DAYS = 14;
const RECENT_WINDOW_MONTHS = 6;
const HISTORY_WINDOW_MONTHS = 18;
const SINGLE_READING_MIN_AGE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MileageReadingLike {
  /** Kilométrage « vie entière » (après application de `odometerOffset`). */
  mileage: number;
  readAt: Date;
  isOutlier?: boolean;
}

export type AvgKmPerDaySource = "REGRESSION" | "SINGLE_READING" | "DEFAULT";

export interface AvgKmPerDayResult {
  avgKmPerDay: number | null;
  source: AvgKmPerDaySource;
}

export interface ComputeAvgKmPerDayInput {
  readings: MileageReadingLike[];
  usage: VehicleUsage;
  now: Date;
  /** Date de première mise en circulation, utilisée pour l'estimation à un seul relevé. */
  firstRegistrationDate?: Date | null;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Régression linéaire pondérée (moindres carrés) : mileage = a + b * jourOffset.
 * Retourne la pente `b` (km/jour).
 */
function weightedLinearRegressionSlope(points: Array<{ x: number; y: number; w: number }>): number {
  let sw = 0;
  let swx = 0;
  let swy = 0;
  let swxy = 0;
  let swxx = 0;
  for (const { x, y, w } of points) {
    sw += w;
    swx += w * x;
    swy += w * y;
    swxy += w * x * y;
    swxx += w * x * x;
  }
  const denominator = sw * swxx - swx * swx;
  if (denominator === 0) {
    return 0;
  }
  return (sw * swxy - swx * swy) / denominator;
}

/**
 * RG-M02-10 — kilométrage moyen par jour, à partir de l'historique des relevés
 * (18 derniers mois, hors relevés aberrants). Nécessite au moins 2 relevés
 * espacés d'au moins 14 jours ; sinon tente l'estimation à un seul relevé
 * (RG-M02-10 §5) puis, à défaut, la valeur par défaut selon l'usage.
 */
export function computeAvgKmPerDay(input: ComputeAvgKmPerDayInput): AvgKmPerDayResult {
  const windowStart = addMonths(input.now, -HISTORY_WINDOW_MONTHS);
  const recentStart = addMonths(input.now, -RECENT_WINDOW_MONTHS);

  const readings = input.readings
    .filter((r) => !r.isOutlier && r.readAt >= windowStart && r.readAt <= input.now)
    .sort((a, b) => a.readAt.getTime() - b.readAt.getTime());

  if (readings.length >= 2) {
    const first = readings[0]!;
    const last = readings[readings.length - 1]!;
    const spanDays = daysBetween(first.readAt, last.readAt);

    if (spanDays >= MIN_READING_GAP_DAYS) {
      const points = readings.map((r) => ({
        x: daysBetween(first.readAt, r.readAt),
        y: r.mileage,
        w: r.readAt >= recentStart ? 2 : 1,
      }));
      const slope = weightedLinearRegressionSlope(points);
      return {
        avgKmPerDay: clamp(slope, MIN_AVG_KM_PER_DAY, MAX_AVG_KM_PER_DAY),
        source: "REGRESSION",
      };
    }
  }

  if (readings.length === 1 && input.firstRegistrationDate) {
    const ageDays = daysBetween(input.firstRegistrationDate, input.now);
    if (ageDays >= SINGLE_READING_MIN_AGE_DAYS) {
      const avg = clamp(readings[0]!.mileage / ageDays, MIN_AVG_KM_PER_DAY, MAX_AVG_KM_PER_DAY);
      return { avgKmPerDay: avg, source: "SINGLE_READING" };
    }
  }

  return { avgKmPerDay: DEFAULT_AVG_KM_PER_DAY[input.usage], source: "DEFAULT" };
}

/** RG-M02-11 — kilométrage estimé à une date donnée (ex. aujourd'hui). */
export function computeEstimatedMileage(input: {
  currentMileage: number;
  currentMileageAt: Date;
  avgKmPerDay: number;
  at: Date;
}): number {
  const days = Math.max(0, daysBetween(input.currentMileageAt, input.at));
  return input.currentMileage + Math.round(input.avgKmPerDay * days);
}
