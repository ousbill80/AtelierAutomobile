// RG-M12-01 — périodes du tableau de bord. Une période est `[from, to)` en dates locales du
// fuseau de l'organisation, convertie en instants UTC pour les requêtes. La période de
// comparaison est la période précédente de même durée (mois en cours du 1er au 18 → du 1er au
// 18 du mois précédent).
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const PERIOD_PRESETS = ["today", "7d", "month", "prev_month", "30d"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface ResolvedPeriod {
  preset: PeriodPreset;
  /** Dates locales `yyyy-MM-dd`, borne de fin exclusive. */
  fromDate: string;
  toDate: string;
  previousFromDate: string;
  previousToDate: string;
  /** Instants UTC correspondants. */
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function shiftDay(day: string, days: number): string {
  return new Date(parseDay(day).getTime() + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function firstOfMonth(day: string, monthOffset = 0): string {
  const d = parseDay(day);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1))
    .toISOString()
    .slice(0, 10);
}

/** Jour local `yyyy-MM-dd` de l'instant `now` dans le fuseau `timeZone`. */
export function localDay(now: Date, timeZone: string): string {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** Début (UTC) du jour local `day` dans `timeZone`. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  return fromZonedTime(`${day}T00:00:00`, timeZone);
}

export function resolvePeriod(preset: PeriodPreset, now: Date, timeZone: string): ResolvedPeriod {
  const today = localDay(now, timeZone);
  const tomorrow = shiftDay(today, 1);
  let fromDate: string;
  let toDate: string;
  let previousFromDate: string;
  let previousToDate: string;

  switch (preset) {
    case "today":
      fromDate = today;
      toDate = tomorrow;
      previousFromDate = shiftDay(today, -1);
      previousToDate = today;
      break;
    case "7d":
    case "30d": {
      const days = preset === "7d" ? 7 : 30;
      fromDate = shiftDay(tomorrow, -days);
      toDate = tomorrow;
      previousFromDate = shiftDay(fromDate, -days);
      previousToDate = fromDate;
      break;
    }
    case "month": {
      fromDate = firstOfMonth(today);
      toDate = tomorrow;
      previousFromDate = firstOfMonth(today, -1);
      const elapsed = Math.round(
        (parseDay(toDate).getTime() - parseDay(fromDate).getTime()) / MS_PER_DAY,
      );
      const candidate = shiftDay(previousFromDate, elapsed);
      // Mois précédent plus court (31/03 → 28/02) : on borne au début du mois en cours.
      previousToDate = candidate > fromDate ? fromDate : candidate;
      break;
    }
    case "prev_month":
      fromDate = firstOfMonth(today, -1);
      toDate = firstOfMonth(today);
      previousFromDate = firstOfMonth(today, -2);
      previousToDate = fromDate;
      break;
  }

  return {
    preset,
    fromDate,
    toDate,
    previousFromDate,
    previousToDate,
    from: startOfLocalDay(fromDate, timeZone),
    to: startOfLocalDay(toDate, timeZone),
    previousFrom: startOfLocalDay(previousFromDate, timeZone),
    previousTo: startOfLocalDay(previousToDate, timeZone),
  };
}

export type Variation = { kind: "pct"; pct: number } | { kind: "new" } | { kind: "none" };

/** RG-M12-01 : `round((v − v_prec) / v_prec × 100)` ; `v_prec = 0` → « nouveau ». */
export function variation(value: number, previous: number): Variation {
  if (previous === 0) return value === 0 ? { kind: "none" } : { kind: "new" };
  return { kind: "pct", pct: Math.round(((value - previous) / previous) * 100) };
}

/** Vrai si l'instant `at` est dans `[from, to)`. */
export function inRange(at: Date | null | undefined, from: Date, to: Date): boolean {
  if (!at) return false;
  const t = at.getTime();
  return t >= from.getTime() && t < to.getTime();
}
