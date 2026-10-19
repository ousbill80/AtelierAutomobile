import { fr } from "date-fns/locale/fr";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TZ = "Africa/Abidjan";

/** `yyyy-MM-dd` du jour civil d'un instant dans le fuseau. */
export function civilDay(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

export function instantAt(day: string, time: string, tz: string): Date {
  return fromZonedTime(`${day}T${time}:00`, tz);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + n));
  return date.toISOString().slice(0, 10);
}

/** Lundi de la semaine du jour civil. */
export function startOfWeek(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  const weekday = (date.getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function formatTime(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "HH:mm");
}

export function formatDate(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "dd/MM/yyyy");
}

export function formatDateTime(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, "dd/MM/yyyy HH:mm");
}

/** « samedi 24/10/2026 » */
export function formatLongDay(dayOrDate: string | Date, tz: string): string {
  const date = typeof dayOrDate === "string" ? instantAt(dayOrDate, "12:00", tz) : dayOrDate;
  return formatInTimeZone(date, tz, "EEEE dd/MM/yyyy", { locale: fr });
}

/** « sam. 24/10 » */
export function formatShortDay(day: string, tz: string): string {
  return formatInTimeZone(instantAt(day, "12:00", tz), tz, "EEE dd/MM", { locale: fr });
}

export function minutesOfDay(date: Date, tz: string): number {
  const [h, m] = formatInTimeZone(date, tz, "HH:mm").split(":").map(Number);
  return h! * 60 + m!;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

export function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function weekdayKey(day: string): "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" {
  const [y, m, d] = day.split("-").map(Number);
  const index = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[index];
}

export type OpeningHoursMap = Partial<Record<string, Array<[string, string]>>>;

/** Plages d'ouverture (minutes depuis minuit) d'un jour civil, pause retirée. */
export function openingRanges(
  openingHours: OpeningHoursMap,
  day: string,
  lunchBreak: [string, string] | null,
): Array<[number, number]> {
  const ranges = (openingHours[weekdayKey(day)] ?? []).map(
    ([s, e]) => [toMinutes(s), toMinutes(e)] as [number, number],
  );
  ranges.sort((a, b) => a[0] - b[0]);
  if (!lunchBreak) return ranges;
  const [ls, le] = [toMinutes(lunchBreak[0]), toMinutes(lunchBreak[1])];
  const out: Array<[number, number]> = [];
  for (const [s, e] of ranges) {
    if (le <= s || ls >= e) {
      out.push([s, e]);
      continue;
    }
    if (ls > s) out.push([s, ls]);
    if (le < e) out.push([le, e]);
  }
  return out;
}
