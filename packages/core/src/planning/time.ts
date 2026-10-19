import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { WeekdayKey } from "../organization/opening-hours";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "07:30" → 450. Lève une erreur sur un format invalide (données déjà validées en amont). */
export function hhmmToMinutes(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new Error(`Heure invalide : « ${time} »`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Jour civil local (`yyyy-MM-dd`) d'un instant dans le fuseau de l'organisation (RG-M03-15). */
export function localDateKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** Minutes écoulées depuis minuit local. */
export function localMinutes(date: Date, timeZone: string): number {
  return hhmmToMinutes(formatInTimeZone(date, timeZone, "HH:mm"));
}

/** Instant UTC correspondant à `dateKey` + `minutes` (heure locale du fuseau). */
export function zonedInstant(dateKey: string, minutes: number, timeZone: string): Date {
  return fromZonedTime(`${dateKey}T${minutesToHhmm(minutes)}:00`, timeZone);
}

const WEEKDAYS: readonly WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Clé de jour (`mon` … `sun`) d'un jour civil `yyyy-MM-dd`. */
export function weekdayKeyOf(dateKey: string): WeekdayKey {
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return WEEKDAYS[day]!;
}

/** Ajoute `days` jours civils à `dateKey`. */
export function addDaysToKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant `dateKey`. */
export function startOfWeekKey(dateKey: string): string {
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDaysToKey(dateKey, offset);
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

export function durationMinutes(interval: { startsAt: Date; endsAt: Date }): number {
  return Math.round((interval.endsAt.getTime() - interval.startsAt.getTime()) / 60_000);
}

/** Minutes de recouvrement entre deux intervalles (0 si disjoints). */
export function overlapMinutes(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
): number {
  const start = Math.max(a.startsAt.getTime(), b.startsAt.getTime());
  const end = Math.min(a.endsAt.getTime(), b.endsAt.getTime());
  return end > start ? Math.round((end - start) / 60_000) : 0;
}
