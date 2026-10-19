// RG-M10-06 / RG-M10-07 — un seul palier à la fois, rattrapage borné, jamais de palier
// inférieur à un palier déjà envoyé, espacement minimal entre deux envois (§9.1 pickStep).
import { addDays } from "./dates";

export interface PickStepRuleStep {
  key: string;
  offsetDays: number;
  catchUpDays?: number;
}

export interface PickStepHistoryEntry {
  stepKey: string;
  status: string; // ReminderStatus
  sentAt: Date | null;
}

export interface PickStepInput {
  steps: readonly PickStepRuleStep[];
  anchor: Date;
  today: Date;
  /** Tous les `Reminder` déjà créés pour cette `sequenceKey` (tout statut). */
  history: readonly PickStepHistoryEntry[];
  minGapDays: number;
  /** `catchUpDays` par défaut si le palier n'en définit pas (`settings.reminders.catchUpDays`). */
  defaultCatchUpDays: number;
}

export interface PickStepResult {
  step: PickStepRuleStep;
  /** Date à partir de laquelle l'envoi est autorisé (espacement `minGapDays`), sinon `null`. */
  notBefore: Date | null;
  /** Vrai si la cible du palier est déjà passée (création en rattrapage). */
  catchUp: boolean;
}

export function targetDate(anchor: Date, step: { offsetDays: number }): Date {
  return addDays(anchor, step.offsetDays);
}

function byOffset(a: PickStepRuleStep, b: PickStepRuleStep): number {
  return a.offsetDays - b.offsetDays;
}

export function pickStep(input: PickStepInput): PickStepResult | null {
  const { steps, anchor, today, history, minGapDays, defaultCatchUpDays } = input;
  const sorted = [...steps].sort(byOffset);

  const due = sorted.filter((s) => targetDate(anchor, s).getTime() <= today.getTime());
  if (due.length === 0) return null;
  const step = due[due.length - 1]!;

  if (history.some((r) => r.stepKey === step.key)) return null;

  const sentHistory = history.filter(
    (r): r is PickStepHistoryEntry & { sentAt: Date } => r.status === "SENT" && r.sentAt !== null,
  );
  const lastSent =
    sentHistory.length > 0
      ? sentHistory.reduce((a, b) => (a.sentAt.getTime() >= b.sentAt.getTime() ? a : b))
      : null;

  const stepIndex = sorted.findIndex((s) => s.key === step.key);
  if (lastSent) {
    const lastSentIndex = sorted.findIndex((s) => s.key === lastSent.stepKey);
    if (lastSentIndex >= 0 && lastSentIndex >= stepIndex) return null;
  }

  const next = sorted[stepIndex + 1];
  const limit = next
    ? addDays(targetDate(anchor, next), -minGapDays - 1)
    : addDays(targetDate(anchor, step), step.catchUpDays ?? defaultCatchUpDays);
  if (today.getTime() > limit.getTime()) return null;

  let notBefore: Date | null = null;
  if (lastSent) {
    const daysSinceLastSent = Math.trunc(
      (today.getTime() - lastSent.sentAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysSinceLastSent < minGapDays) {
      notBefore = addDays(lastSent.sentAt, minGapDays);
    }
  }

  return { step, notBefore, catchUp: targetDate(anchor, step).getTime() < today.getTime() };
}

/**
 * RG-M10-07 — paliers à faire basculer `CANCELLED` (remplacés) lorsqu'un nouveau palier
 * `createdStepKey` est créé pour la séquence : tout `Reminder` antérieur au nouveau palier,
 * encore `PLANNED`/`NEEDS_APPROVAL`/`SNOOZED`.
 */
export function stepsToSupersede<T extends { stepKey: string; status: string }>(
  steps: readonly PickStepRuleStep[],
  createdStepKey: string,
  history: readonly T[],
): T[] {
  const sorted = [...steps].sort(byOffset);
  const createdIndex = sorted.findIndex((s) => s.key === createdStepKey);
  if (createdIndex < 0) return [];
  const supersedable = new Set(["PLANNED", "NEEDS_APPROVAL", "SNOOZED"]);
  return history.filter((r) => {
    if (!supersedable.has(r.status)) return false;
    const index = sorted.findIndex((s) => s.key === r.stepKey);
    return index >= 0 && index < createdIndex;
  });
}
