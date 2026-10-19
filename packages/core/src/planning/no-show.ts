import { formatInTimeZone } from "date-fns-tz";
import type { AppointmentStatus } from "./types";

const PENDING_STATUSES: readonly AppointmentStatus[] = ["BOOKED", "CONFIRMED"];

/** US-M03-09 — « En retard / absent ? » : RDV BOOKED/CONFIRMED dont début + seuil est dépassé. */
export function isLate(input: {
  startsAt: Date;
  status: AppointmentStatus;
  now: Date;
  lateAfterMinutes: number;
}): boolean {
  if (!PENDING_STATUSES.includes(input.status)) return false;
  return input.now.getTime() >= input.startsAt.getTime() + input.lateAfterMinutes * 60_000;
}

export interface NoShowEligibilityInput {
  startsAt: Date;
  status: AppointmentStatus;
  now: Date;
  timeZone: string;
  /** Heure locale `HH:mm` du job (settings.appointments.noShowJobTime, défaut 20:00). */
  noShowJobTime: string;
}

/**
 * RG-M03-10 — passage automatique en NO_SHOW : RDV du jour (fuseau du site) encore
 * BOOKED/CONFIRMED, une fois l'heure locale du job atteinte. Les RDV des jours précédents
 * jamais traités (job manqué) sont également éligibles.
 */
export function noShowEligibility(input: NoShowEligibilityInput): boolean {
  if (!PENDING_STATUSES.includes(input.status)) return false;
  if (input.startsAt >= input.now) return false;
  const appointmentDay = formatInTimeZone(input.startsAt, input.timeZone, "yyyy-MM-dd");
  const today = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  if (appointmentDay < today) return true;
  if (appointmentDay > today) return false;
  const localTime = formatInTimeZone(input.now, input.timeZone, "HH:mm");
  return localTime >= input.noShowJobTime;
}

export const NO_SHOW_REVERT_WINDOW_HOURS = 48;

/** RG-M03-10 — un NO_SHOW peut être repassé ARRIVED dans les 48 h. */
export function canRevertNoShow(input: { noShowAt: Date | null; now: Date }): boolean {
  if (!input.noShowAt) return false;
  return input.now.getTime() - input.noShowAt.getTime() <= NO_SHOW_REVERT_WINDOW_HOURS * 3_600_000;
}

/** `Customer.noShowCount12m` — absences sur 12 mois glissants (RG-M03-10). */
export function countNoShows12m(
  appointments: ReadonlyArray<{ status: AppointmentStatus; startsAt: Date }>,
  now: Date,
): number {
  const floor = new Date(now.getTime());
  floor.setUTCFullYear(floor.getUTCFullYear() - 1);
  return appointments.filter(
    (a) => a.status === "NO_SHOW" && a.startsAt >= floor && a.startsAt <= now,
  ).length;
}

export const NO_SHOW_BADGE_THRESHOLD = 2;

/** ≥ 2 absences sur 12 mois → badge et confirmation J-1 obligatoire (US-M03-09). */
export function requiresMandatoryConfirmation(noShowCount12m: number): boolean {
  return noShowCount12m >= NO_SHOW_BADGE_THRESHOLD;
}
