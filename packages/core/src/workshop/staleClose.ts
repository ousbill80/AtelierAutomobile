// M06 §9 `workshop.close_stale` — RG-M06-07 (pauses > 4 h ou passant minuit) et US-M06-09
// (présence sans départ) : décisions de clôture automatique, appliquées par le worker.
import { localDateKey, localMinutes } from "../planning/time";
import { timeEntryState, type TimeEntryLike } from "./timeEntry";

export const MAX_PAUSE_MS = 4 * 3_600_000;

/** Fin de journée : la clôture des entrées et présences ouvertes a lieu à partir de 23:30. */
export const END_OF_DAY_MINUTES = 23 * 60 + 30;

export interface StaleEntry extends TimeEntryLike {
  id: string;
}

export type StaleEntryReason = "pause_expired" | "end_of_day";

export interface StaleEntryClosure {
  id: string;
  endedAt: Date;
  reason: StaleEntryReason;
}

/**
 * - Pause de plus de 4 h, ou commencée un jour précédent → close à `pausedAt`.
 * - Entrée en cours en fin de journée (≥ 23:30 locale) ou démarrée un jour précédent → close à
 *   `now` (fin de journée) ou à minuit moins une minute du jour de départ, `needsReview`.
 */
export function decideStaleEntry(
  entry: StaleEntry,
  now: Date,
  timeZone: string,
): StaleEntryClosure | null {
  const state = timeEntryState(entry);
  if (state === "STOPPED") return null;
  const today = localDateKey(now, timeZone);
  if (state === "PAUSED" && entry.pausedAt) {
    const tooLong = now.getTime() - entry.pausedAt.getTime() > MAX_PAUSE_MS;
    const pastMidnight = localDateKey(entry.pausedAt, timeZone) !== today;
    if (tooLong || pastMidnight) {
      return { id: entry.id, endedAt: entry.pausedAt, reason: "pause_expired" };
    }
    return null;
  }
  const startedDay = localDateKey(entry.startedAt, timeZone);
  if (startedDay !== today) {
    return {
      id: entry.id,
      endedAt: endOfLocalDay(entry.startedAt, timeZone),
      reason: "end_of_day",
    };
  }
  if (localMinutes(now, timeZone) >= END_OF_DAY_MINUTES) {
    return { id: entry.id, endedAt: now, reason: "end_of_day" };
  }
  return null;
}

/** 23:59 locale du jour de `date`. */
export function endOfLocalDay(date: Date, timeZone: string): Date {
  const minutesToEnd = 23 * 60 + 59 - localMinutes(date, timeZone);
  return new Date(date.getTime() + Math.max(0, minutesToEnd) * 60_000);
}

export interface StaleAttendance {
  id: string;
  date: Date; // @db.Date (minuit UTC du jour local)
  clockIn: Date | null;
  clockOut: Date | null;
}

/**
 * US-M06-09 : présence sans départ → close à la fin de la dernière `TimeEntry` du jour (ou à la
 * fermeture du site, sinon à la fin de journée), `autoClosed = true`. Seulement en fin de
 * journée ou pour un jour passé.
 */
export function decideStaleAttendance(
  attendance: StaleAttendance,
  lastEntryEnd: Date | null,
  siteCloseAt: Date | null,
  now: Date,
  timeZone: string,
): Date | null {
  if (!attendance.clockIn || attendance.clockOut) return null;
  const today = localDateKey(now, timeZone);
  const day = attendance.date.toISOString().slice(0, 10);
  if (day === today && localMinutes(now, timeZone) < END_OF_DAY_MINUTES) return null;
  const candidates = [lastEntryEnd, siteCloseAt].filter(
    (d): d is Date => !!d && d.getTime() > attendance.clockIn!.getTime(),
  );
  if (lastEntryEnd && candidates.includes(lastEntryEnd)) return lastEntryEnd;
  if (candidates.length > 0) return candidates[0]!;
  const end = day === today ? now : endOfLocalDay(attendance.clockIn, timeZone);
  return end.getTime() > now.getTime() ? now : end;
}
