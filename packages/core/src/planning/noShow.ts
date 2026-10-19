// RG-M03-10 — retards, passage automatique en NO_SHOW (job 20:00 heure du site) et correction.
import { hhmmToMinutes, localDateKey, localMinutes } from "./time";
import { PENDING_STATUSES, type AppointmentStatusKey } from "./types";

export const NO_SHOW_REVERT_HOURS = 48;
export const NO_SHOW_BADGE_THRESHOLD = 2;

interface PendingLike {
  status: AppointmentStatusKey;
  startsAt: Date;
}

/** « En retard / absent ? » : début + seuil dépassé sans arrivée. */
export function isLate(appt: PendingLike, now: Date, lateAfterMinutes: number): boolean {
  return (
    PENDING_STATUSES.includes(appt.status) &&
    now.getTime() >= appt.startsAt.getTime() + lateAfterMinutes * 60_000
  );
}

/**
 * Le job passe en NO_SHOW les RDV encore BOOKED/CONFIRMED d'un jour passé, ou du jour même
 * une fois `jobTime` (heure locale du site) atteinte.
 */
export function noShowEligibility(
  appt: PendingLike,
  now: Date,
  timeZone: string,
  jobTime: string,
): boolean {
  if (!PENDING_STATUSES.includes(appt.status)) return false;
  if (appt.startsAt.getTime() > now.getTime()) return false;
  const apptDay = localDateKey(appt.startsAt, timeZone);
  const today = localDateKey(now, timeZone);
  if (apptDay < today) return true;
  return apptDay === today && localMinutes(now, timeZone) >= hhmmToMinutes(jobTime);
}

export function canRevertNoShow(noShowAt: Date | null, now: Date): boolean {
  return (
    noShowAt !== null && now.getTime() - noShowAt.getTime() <= NO_SHOW_REVERT_HOURS * 3_600_000
  );
}

/** `Customer.noShowCount12m` — calculé à la volée sur 12 mois glissants. */
export function noShowCount12m(
  appointments: ReadonlyArray<{ status: AppointmentStatusKey; startsAt: Date }>,
  now: Date,
): number {
  const since = new Date(now);
  since.setUTCFullYear(since.getUTCFullYear() - 1);
  return appointments.filter(
    (a) => a.status === "NO_SHOW" && a.startsAt >= since && a.startsAt <= now,
  ).length;
}

/** ≥ 2 absences sur 12 mois → badge et confirmation J-1 obligatoire. */
export function requiresMandatoryConfirmation(noShowCount: number): boolean {
  return noShowCount >= NO_SHOW_BADGE_THRESHOLD;
}

/** RG-M03-11 : annulation client moins de 2 h avant → « annulation tardive » (statistique). */
export function isLateCancellation(startsAt: Date, cancelledAt: Date): boolean {
  return startsAt.getTime() - cancelledAt.getTime() < 2 * 3_600_000;
}
