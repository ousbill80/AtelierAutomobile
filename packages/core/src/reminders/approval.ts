import type { ReminderChannel, ReminderStatus } from "./types";

/** RG-M10-18 — mode d'envoi configuré par l'organisation (`settings.reminders.approvalMode`). */
export type ApprovalMode = "PER_STEP" | "MANUAL_ALL" | "PAUSED";

export interface InitialStatusInput {
  autoSend: boolean;
  approvalMode: ApprovalMode;
  /** `true` si la date cible du palier est déjà passée (rattrapage, RG-M10-06). */
  isCatchUp: boolean;
  /** RG-M10-31 — aucun canal utilisable pour ce destinataire. */
  hasChannel: boolean;
}

/**
 * RG-M10-18/RG-M10-31 — statut initial d'une relance planifiée : validation requise si le mode
 * `MANUAL_ALL` est actif, si c'est un rattrapage (RG-M10-06/09.1), ou si le client n'a aucun canal
 * utilisable ; sinon suit `step.autoSend`.
 */
export function initialReminderStatus(
  input: InitialStatusInput,
): Extract<ReminderStatus, "PLANNED" | "NEEDS_APPROVAL"> {
  if (!input.hasChannel) return "NEEDS_APPROVAL";
  if (input.approvalMode === "MANUAL_ALL") return "NEEDS_APPROVAL";
  if (input.isCatchUp) return "NEEDS_APPROVAL";
  return input.autoSend ? "PLANNED" : "NEEDS_APPROVAL";
}

/** RG-M10-18 — interrupteur général : aucun envoi ne doit partir tant que `PAUSED` est actif. */
export function isDispatchPaused(approvalMode: ApprovalMode): boolean {
  return approvalMode === "PAUSED";
}

export const DEFAULT_APPROVAL_MODE: ApprovalMode = "PER_STEP";

/** Canal par défaut d'une relance sans canal utilisable (RG-M10-31 : onglet « À appeler »). */
export const NO_CHANNEL: ReminderChannel | null = null;
