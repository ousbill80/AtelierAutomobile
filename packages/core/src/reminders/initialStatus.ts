// RG-M10-18 (mode d'envoi, rodage) et RG-M10-29 (fraîcheur des données en REMINDERS_ONLY).

export type InitialReminderStatus = "SENT" | "NEEDS_APPROVAL" | "PLANNED";

export interface InitialStatusInput {
  step: { internalOnly: boolean; autoSend: boolean; requiresPermission?: string | null };
  /** La cible du palier est déjà passée (`pickStep().catchUp`). */
  catchUp: boolean;
  /** Premier passage du planificateur depuis l'activation de la règle (rattrapages initiaux). */
  isFirstRunOfRule: boolean;
  approvalMode: "PER_STEP" | "MANUAL_ALL" | "PAUSED";
  /** Dans les 14 j suivant l'activation des relances ou un import initial M13. */
  inWarmup: boolean;
  isReceivable: boolean;
  operatingMode: "FULL" | "REMINDERS_ONLY";
  dataAgeHours: number | null;
  maxDataAgeHours: number;
}

/** Statut initial d'un `Reminder` nouvellement créé par `reminders.plan`. */
export function initialStatus(input: InitialStatusInput): InitialReminderStatus {
  if (input.step.internalOnly) return "SENT";
  if (input.approvalMode === "MANUAL_ALL" || input.inWarmup) return "NEEDS_APPROVAL";
  if (input.catchUp && input.isFirstRunOfRule) return "NEEDS_APPROVAL";
  if (input.step.requiresPermission) return "NEEDS_APPROVAL";
  if (
    input.operatingMode === "REMINDERS_ONLY" &&
    input.isReceivable &&
    input.dataAgeHours != null &&
    input.dataAgeHours > input.maxDataAgeHours
  ) {
    return "NEEDS_APPROVAL";
  }
  return input.step.autoSend ? "PLANNED" : "NEEDS_APPROVAL";
}
