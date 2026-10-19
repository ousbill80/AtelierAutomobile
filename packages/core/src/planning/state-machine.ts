import { DomainError } from "../errors";
import type { AppointmentStatus } from "./types";

export type AppointmentAction =
  "confirm" | "arrive" | "complete" | "cancel" | "no_show" | "revert_no_show" | "reschedule";

/** M03 §5 — machine à états. */
export const TRANSITIONS: Record<
  AppointmentAction,
  { from: readonly AppointmentStatus[]; to: AppointmentStatus }
> = {
  confirm: { from: ["BOOKED"], to: "CONFIRMED" },
  arrive: { from: ["BOOKED", "CONFIRMED"], to: "ARRIVED" },
  complete: { from: ["ARRIVED"], to: "COMPLETED" },
  cancel: { from: ["BOOKED", "CONFIRMED"], to: "CANCELLED" },
  no_show: { from: ["BOOKED", "CONFIRMED"], to: "NO_SHOW" },
  revert_no_show: { from: ["NO_SHOW"], to: "ARRIVED" },
  // Déplacement / modification d'horaire : le statut ne change pas, mais seuls les RDV
  // non terminaux et non arrivés sont modifiables.
  reschedule: { from: ["BOOKED", "CONFIRMED"], to: "BOOKED" },
};

export const TERMINAL_STATUSES: readonly AppointmentStatus[] = ["COMPLETED", "CANCELLED"];

export function isTerminalStatus(status: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(status: AppointmentStatus, action: AppointmentAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

const ACTION_LABELS: Record<AppointmentAction, string> = {
  confirm: "de confirmer",
  arrive: "de marquer arrivé",
  complete: "de terminer",
  cancel: "d'annuler",
  no_show: "de marquer absent",
  revert_no_show: "de corriger l'absence d'",
  reschedule: "de déplacer",
};

/** Statut cible d'une transition, ou `DomainError appointment.invalid_transition`. */
export function nextStatus(
  status: AppointmentStatus,
  action: AppointmentAction,
): AppointmentStatus {
  if (!canTransition(status, action)) {
    throw new DomainError(
      "appointment.invalid_transition",
      `Impossible ${ACTION_LABELS[action]}${action === "revert_no_show" ? "" : " "}un rendez-vous au statut « ${status} ».`,
      { status, action },
    );
  }
  return action === "reschedule" ? status : TRANSITIONS[action].to;
}
