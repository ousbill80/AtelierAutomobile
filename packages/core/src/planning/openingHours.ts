// RG-M03-01 — un RDV doit être entièrement dans les horaires du site, hors jours fériés
// (`Holiday`, A1) et hors pause midi si elle est configurée.
import { isHoliday, type HolidayLike } from "../calendar";
import type { OpeningHours } from "../organization/opening-hours";
import { hhmmToMinutes, localDateKey, localMinutes, weekdayKeyOf, zonedInstant } from "./time";

export interface OpeningContext {
  timeZone: string;
  openingHours: OpeningHours;
  holidays?: readonly HolidayLike[];
  siteId?: string | null;
  lunchBreak?: readonly [string, string] | null;
}

/** Plages ouvertes `[début, fin)` (minutes locales) d'un jour civil ; vide si fermé ou férié. */
export function openIntervalsForDay(dateKey: string, ctx: OpeningContext): Array<[number, number]> {
  const noon = zonedInstant(dateKey, 12 * 60, ctx.timeZone);
  if (isHoliday(noon, ctx.siteId ?? null, ctx.holidays ?? [], ctx.timeZone)) return [];
  const ranges = ctx.openingHours[weekdayKeyOf(dateKey)] ?? [];
  let intervals = ranges
    .map(([from, to]) => [hhmmToMinutes(from), hhmmToMinutes(to)] as [number, number])
    .filter(([from, to]) => to > from)
    .sort((x, y) => x[0] - y[0]);
  if (ctx.lunchBreak) {
    const [ls, le] = [hhmmToMinutes(ctx.lunchBreak[0]), hhmmToMinutes(ctx.lunchBreak[1])];
    intervals = intervals.flatMap(([from, to]): Array<[number, number]> => {
      if (le <= from || ls >= to) return [[from, to]];
      const parts: Array<[number, number]> = [];
      if (ls > from) parts.push([from, ls]);
      if (le < to) parts.push([le, to]);
      return parts;
    });
  }
  return intervals;
}

/** Vrai si `[startsAt, endsAt)` tient entièrement dans une seule plage ouverte du même jour. */
export function isWithinOpeningHours(startsAt: Date, endsAt: Date, ctx: OpeningContext): boolean {
  if (endsAt.getTime() <= startsAt.getTime()) return false;
  const dateKey = localDateKey(startsAt, ctx.timeZone);
  // Un RDV qui finit à minuit pile reste le même jour ; au-delà, il déborde.
  const lastInstant = new Date(endsAt.getTime() - 1);
  if (localDateKey(lastInstant, ctx.timeZone) !== dateKey) return false;
  const start = localMinutes(startsAt, ctx.timeZone);
  const end = start + Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000);
  return openIntervalsForDay(dateKey, ctx).some(([from, to]) => start >= from && end <= to);
}
