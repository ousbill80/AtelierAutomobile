import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { HolidayLike } from "../calendar";
import { isHoliday } from "../calendar";
import type { OpeningHours, WeekdayKey } from "../organization/opening-hours";
import type { TimeRange } from "./types";

const WEEKDAY_BY_INDEX: readonly WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Jour civil `yyyy-MM-dd` d'un instant dans le fuseau donné. */
export function civilDay(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** Clé de jour de semaine (`mon`…`sun`) d'un instant dans le fuseau donné. */
export function weekdayKey(date: Date, timeZone: string): WeekdayKey {
  const index = Number(formatInTimeZone(date, timeZone, "i")) % 7;
  return WEEKDAY_BY_INDEX[index]!;
}

/** Instant UTC correspondant à `HH:mm` du jour civil `yyyy-MM-dd` dans le fuseau. */
export function instantAt(day: string, time: string, timeZone: string): Date {
  return fromZonedTime(`${day}T${time}:00`, timeZone);
}

/** Minuit (début) du jour civil contenant `date`, dans le fuseau. */
export function startOfCivilDay(date: Date, timeZone: string): Date {
  return instantAt(civilDay(date, timeZone), "00:00", timeZone);
}

/** Jour civil suivant, sous forme d'instant à minuit (début de journée). */
export function nextCivilDay(date: Date, timeZone: string): Date {
  const start = startOfCivilDay(date, timeZone);
  // 26 h pour franchir à coup sûr la frontière de jour, puis ré-alignement sur minuit.
  return startOfCivilDay(new Date(start.getTime() + 26 * 60 * 60 * 1000), timeZone);
}

/** Retire `[cutStart, cutEnd)` d'une liste de plages (utilisé pour la pause déjeuner). */
export function subtractRange(ranges: TimeRange[], cut: TimeRange): TimeRange[] {
  const result: TimeRange[] = [];
  for (const range of ranges) {
    if (cut.end <= range.start || cut.start >= range.end) {
      result.push(range);
      continue;
    }
    if (cut.start > range.start) {
      result.push({ start: range.start, end: cut.start });
    }
    if (cut.end < range.end) {
      result.push({ start: cut.end, end: range.end });
    }
  }
  return result;
}

export interface OpeningRangesOptions {
  /** Pause déjeuner `["12:30","13:30"]` retirée des plages (settings.planning.lunchBreak). */
  lunchBreak?: readonly [string, string] | null;
  holidays?: readonly HolidayLike[];
  siteId?: string | null;
}

/**
 * Plages d'ouverture effectives (instants UTC) du jour civil contenant `date`, dans l'ordre
 * chronologique. Vide si le jour est fermé ou férié (A1 : jours fériés via `Holiday`).
 */
export function openingRangesForDay(
  openingHours: OpeningHours,
  date: Date,
  timeZone: string,
  options: OpeningRangesOptions = {},
): TimeRange[] {
  if (isHoliday(date, options.siteId ?? null, options.holidays ?? [], timeZone)) {
    return [];
  }
  const day = civilDay(date, timeZone);
  const key = weekdayKey(date, timeZone);
  const ranges = (openingHours[key] ?? []).map(([start, end]) => ({
    start: instantAt(day, start, timeZone),
    end: instantAt(day, end, timeZone),
  }));
  ranges.sort((a, b) => a.start.getTime() - b.start.getTime());
  if (!options.lunchBreak) {
    return ranges;
  }
  return subtractRange(ranges, {
    start: instantAt(day, options.lunchBreak[0], timeZone),
    end: instantAt(day, options.lunchBreak[1], timeZone),
  });
}

export type OpeningHoursViolation = "HOLIDAY" | "CLOSED_DAY" | "OUTSIDE_RANGE";

export interface WithinOpeningHoursInput extends OpeningRangesOptions {
  startsAt: Date;
  endsAt: Date;
  openingHours: OpeningHours;
  timeZone: string;
}

/**
 * RG-M03-01 — un RDV doit être entièrement contenu dans une plage d'ouverture du jour,
 * hors jours fériés et hors pause configurée. Renvoie la raison du refus le cas échéant.
 */
export function isWithinOpeningHours(
  input: WithinOpeningHoursInput,
): { ok: true } | { ok: false; reason: OpeningHoursViolation } {
  const { startsAt, endsAt, openingHours, timeZone } = input;
  if (isHoliday(startsAt, input.siteId ?? null, input.holidays ?? [], timeZone)) {
    return { ok: false, reason: "HOLIDAY" };
  }
  const ranges = openingRangesForDay(openingHours, startsAt, timeZone, {
    lunchBreak: input.lunchBreak,
  });
  if (ranges.length === 0) {
    return { ok: false, reason: "CLOSED_DAY" };
  }
  const contained = ranges.some((range) => startsAt >= range.start && endsAt <= range.end);
  return contained ? { ok: true } : { ok: false, reason: "OUTSIDE_RANGE" };
}
