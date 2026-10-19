// RG-M03-01 — un RDV doit être entièrement dans Site.openingHours du jour (hors jour férié).
import { formatInTimeZone } from "date-fns-tz";
import { isHoliday, type HolidayLike } from "../calendar";
import { WEEKDAY_KEYS, type OpeningHours, type WeekdayKey } from "../organization/opening-hours";

function toMinutesOfDay(date: Date, timeZone: string): number {
  const [h, m] = formatInTimeZone(date, timeZone, "HH:mm").split(":").map(Number);
  return h! * 60 + m!;
}

function weekdayKeyOf(date: Date, timeZone: string): WeekdayKey {
  // date-fns-tz "i" : 1 = lundi … 7 = dimanche (ISO).
  const iso = Number(formatInTimeZone(date, timeZone, "i"));
  return WEEKDAY_KEYS[iso - 1]!;
}

export interface IsWithinOpeningHoursOptions {
  siteId?: string | null;
  holidays?: readonly HolidayLike[];
}

/**
 * Vrai si `[startsAt, endsAt)` est entièrement contenu dans une plage d'ouverture du site le
 * jour de `startsAt` (fuseau `timeZone`), et que ce jour n'est pas un jour férié. Un RDV qui
 * franchit minuit n'est jamais dans les horaires (les plages sont bornées à un jour civil).
 */
export function isWithinOpeningHours(
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
  openingHours: OpeningHours,
  options: IsWithinOpeningHoursOptions = {},
): boolean {
  const startDay = formatInTimeZone(startsAt, timeZone, "yyyy-MM-dd");
  const endDay = formatInTimeZone(endsAt, timeZone, "yyyy-MM-dd");
  if (startDay !== endDay) return false;

  if (isHoliday(startsAt, options.siteId ?? null, options.holidays ?? [], timeZone)) {
    return false;
  }

  const ranges = openingHours[weekdayKeyOf(startsAt, timeZone)] ?? [];
  const startMinutes = toMinutesOfDay(startsAt, timeZone);
  const endMinutes = toMinutesOfDay(endsAt, timeZone);

  return ranges.some(([from, to]) => {
    const [fromH, fromM] = from.split(":").map(Number);
    const [toH, toM] = to.split(":").map(Number);
    const rangeStart = fromH! * 60 + fromM!;
    const rangeEnd = toH! * 60 + toM!;
    return startMinutes >= rangeStart && endMinutes <= rangeEnd;
  });
}
