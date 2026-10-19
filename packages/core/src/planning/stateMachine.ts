// M03 §5 — machine à états du rendez-vous.
import { DomainError } from "../errors";
import type { AppointmentStatusKey } from "./types";

export type AppointmentAction =
  | "confirm"
  | "arrive"
  | "complete"
  | "cancel"
  | "no_show"
  | "revert_no_show"
  | "reschedule"
  | "edit";

const ALLOWED: Record<AppointmentAction, readonly AppointmentStatusKey[]> = {
  confirm: ["BOOKED"],
  arrive: ["BOOKED", "CONFIRMED"],
  complete: ["ARRIVED"],
  cancel: ["BOOKED", "CONFIRMED"],
  no_show: ["BOOKED", "CONFIRMED"],
  revert_no_show: ["NO_SHOW"],
  reschedule: ["BOOKED", "CONFIRMED"],
  edit: ["BOOKED", "CONFIRMED", "ARRIVED", "NO_SHOW"],
};

const TARGET: Partial<Record<AppointmentAction, AppointmentStatusKey>> = {
  confirm: "CONFIRMED",
  arrive: "ARRIVED",
  complete: "COMPLETED",
  cancel: "CANCELLED",
  no_show: "NO_SHOW",
  revert_no_show: "ARRIVED",
};

const MESSAGES: Record<AppointmentAction, string> = {
  confirm: "Seul un RDV réservé peut être confirmé.",
  arrive: "Ce RDV ne peut plus être marqué « client arrivé ».",
  complete: "Seul un RDV dont le client est arrivé peut être terminé.",
  cancel: "Ce RDV ne peut plus être annulé. Si le véhicule est à l'atelier, annulez l'OR.",
  no_show: "Seul un RDV réservé ou confirmé peut être marqué absent.",
  revert_no_show: "Seul un RDV marqué absent peut être corrigé.",
  reschedule: "Ce RDV ne peut plus être déplacé.",
  edit: "Ce RDV est clos : seules les notes restent modifiables.",
};

export function canTransition(status: AppointmentStatusKey, action: AppointmentAction): boolean {
  return ALLOWED[action].includes(status);
}

/** Lève `DomainError("appointment.invalid_transition")` si l'action est interdite ; renvoie le statut cible. */
export function assertTransition(
  status: AppointmentStatusKey,
  action: AppointmentAction,
): AppointmentStatusKey {
  if (!canTransition(status, action)) {
    throw new DomainError("appointment.invalid_transition", MESSAGES[action], { status, action });
  }
  return TARGET[action] ?? status;
}
