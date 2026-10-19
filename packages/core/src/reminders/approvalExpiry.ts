// RG-M10-19 — expiration d'une validation en attente.
import { addDays } from "./dates";
import { targetDate, type PickStepRuleStep } from "./pickStep";

const DEFAULT_APPROVAL_EXPIRY_DAYS = 7;

/** `approvalExpiresAt = min(t(palier suivant) − 1 j, t(palier) + 7 j)`. */
export function approvalExpiry(
  steps: readonly PickStepRuleStep[],
  anchor: Date,
  step: PickStepRuleStep,
  expiryDays: number = DEFAULT_APPROVAL_EXPIRY_DAYS,
): Date {
  const sorted = [...steps].sort((a, b) => a.offsetDays - b.offsetDays);
  const index = sorted.findIndex((s) => s.key === step.key);
  const next = sorted[index + 1];
  const byDefault = addDays(targetDate(anchor, step), expiryDays);
  if (!next) return byDefault;
  const byNext = addDays(targetDate(anchor, next), -1);
  return byNext.getTime() <= byDefault.getTime() ? byNext : byDefault;
}
