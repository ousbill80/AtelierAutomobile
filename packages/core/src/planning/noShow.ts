// RG-M03-10 — absences : seuil de retard (badge « En retard / absent ? »), passage
// automatique en NO_SHOW par le job `appointments.mark_no_show` (20:00 heure du site), et
// correction possible dans les 48 h.
import { formatInTimeZone } from "date-fns-tz";

const NO_SHOW_ELIGIBLE_STATUSES = new Set(["BOOKED", "CONFIRMED"]);

/** Vrai si le RDV est en retard (badge UI), au-delà de `lateAfterMinutes` (défaut 60) sans arrivée. */
export function isAppointmentLate(
  now: Date,
  startsAt: Date,
  status: string,
  lateAfterMinutes = 60,
): boolean {
  if (!NO_SHOW_ELIGIBLE_STATUSES.has(status)) return false;
  return now.getTime() - startsAt.getTime() >= lateAfterMinutes * 60_000;
}

export interface NoShowEligibilityInput {
  status: string;
  startsAt: Date;
  now: Date;
  timeZone: string;
  /** Heure locale du job (défaut "20:00", `settings.appointments.noShowJobTime`). */
  noShowJobTime?: string;
}

/**
 * Vrai si le job `appointments.mark_no_show` doit faire passer ce RDV en `NO_SHOW` : statut
 * encore `BOOKED`/`CONFIRMED`, heure de début déjà passée, et (jour antérieur au jour courant,
 * ou jour courant après l'heure du job en heure locale du site).
 */
export function isEligibleForAutoNoShow(input: NoShowEligibilityInput): boolean {
  if (!NO_SHOW_ELIGIBLE_STATUSES.has(input.status)) return false;
  if (input.startsAt.getTime() > input.now.getTime()) return false;

  const startDay = formatInTimeZone(input.startsAt, input.timeZone, "yyyy-MM-dd");
  const nowDay = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  if (startDay < nowDay) return true;

  const nowTime = formatInTimeZone(input.now, input.timeZone, "HH:mm");
  return nowTime >= (input.noShowJobTime ?? "20:00");
}

/** RG-M03-10 — un `NO_SHOW` peut être repassé `ARRIVED` dans les 48 h suivant `noShowAt`. */
export function canRevertNoShow(noShowAt: Date, now: Date): boolean {
  return now.getTime() - noShowAt.getTime() <= 48 * 60 * 60 * 1000;
}
