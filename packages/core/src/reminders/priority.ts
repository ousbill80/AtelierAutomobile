// RG-M10-16 — table de priorités (0 = hors plafond / plus prioritaire).

export type ReminderTypeLike =
  | "INSPECTION"
  | "SERVICE"
  | "RECEIVABLE"
  | "APPOINTMENT"
  | "QUOTE_FOLLOWUP"
  | "VEHICLE_READY"
  | "INSURANCE_EXPIRY"
  | "SATISFACTION"
  | "RECOMMENDED_WORK"
  | "CUSTOM";

export interface PriorityStep {
  key: string;
  offsetDays: number;
}

export interface PriorityOfOptions {
  /** Relance de promesse rompue (hors séquence, RG-M10-05) : priorité 1 comme les paliers ≥ J+30. */
  isPromiseBroken?: boolean;
}

/**
 * `RECOMMENDED_WORK` (A8) et `CUSTOM` ne figurent pas dans la table RG-M10-16 : rangés au
 * même niveau que les paliers « autres » d'`INSPECTION`/`QUOTE_FOLLOWUP` (priorité 4), à
 * défaut d'arbitrage plus précis.
 */
export function priorityOf(
  type: ReminderTypeLike,
  step: PriorityStep,
  options: PriorityOfOptions = {},
): number {
  if (type === "APPOINTMENT" || type === "VEHICLE_READY") return 0;
  if (type === "RECEIVABLE") {
    if (options.isPromiseBroken || step.offsetDays >= 30) return 1;
    return 3;
  }
  if (type === "INSPECTION") {
    return step.key === "J0" || step.key === "J+7" ? 2 : 4;
  }
  if (type === "QUOTE_FOLLOWUP") return 4;
  if (type === "SERVICE") return 5;
  if (type === "INSURANCE_EXPIRY") return 6;
  if (type === "SATISFACTION") return 7;
  return 4;
}
