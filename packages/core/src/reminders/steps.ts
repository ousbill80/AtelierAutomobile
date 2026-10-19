import { DomainError } from "../errors";
import type { ReminderStep } from "./types";

const STEP_KEY_PATTERN = /^[A-Z0-9+\-_]{1,16}$/;
const MAX_STEPS = 8;
const MIN_STEPS = 1;
const MIN_OFFSET_DAYS = -365;
const MAX_OFFSET_DAYS = 365;
const SEND_AT_PATTERN = /^\d\d:\d\d$/;

export interface StepValidationIssue {
  stepKey?: string;
  message: string;
}

/**
 * RG-M10-03 / RG-M10-06 / US-M10-07 — valide une frise de paliers (`ReminderRule.steps[]`) et
 * retourne la liste des problèmes trouvés (vide = valide). Ne lève jamais : laisse l'appelant
 * décider (aperçu d'erreurs dans l'éditeur). Utiliser {@link validateSteps} pour lever une
 * `DomainError` à la première violation (API / routeur).
 */
export function collectStepIssues(steps: readonly ReminderStep[]): StepValidationIssue[] {
  const issues: StepValidationIssue[] = [];

  if (steps.length < MIN_STEPS) {
    issues.push({ message: "La règle doit comporter au moins un palier." });
  }
  if (steps.length > MAX_STEPS) {
    issues.push({ message: `La règle ne peut pas comporter plus de ${MAX_STEPS} paliers.` });
  }

  const seenKeys = new Set<string>();
  for (const step of steps) {
    if (!STEP_KEY_PATTERN.test(step.key)) {
      issues.push({
        stepKey: step.key,
        message: `La clé de palier « ${step.key} » doit faire 1 à 16 caractères parmi A-Z, 0-9, +, -, _.`,
      });
    }
    if (seenKeys.has(step.key)) {
      issues.push({
        stepKey: step.key,
        message: `La clé de palier « ${step.key} » est dupliquée.`,
      });
    }
    seenKeys.add(step.key);

    if (
      !Number.isInteger(step.offsetDays) ||
      step.offsetDays < MIN_OFFSET_DAYS ||
      step.offsetDays > MAX_OFFSET_DAYS
    ) {
      issues.push({
        stepKey: step.key,
        message: `Le décalage du palier « ${step.key} » doit être un entier entre ${MIN_OFFSET_DAYS} et ${MAX_OFFSET_DAYS} jours.`,
      });
    }

    if (step.internalOnly && step.channels.length > 0) {
      issues.push({
        stepKey: step.key,
        message: `Le palier « ${step.key} » est interne (alerte gérant) : il ne peut pas avoir de canal client.`,
      });
    }

    if (step.sendAt && !SEND_AT_PATTERN.test(step.sendAt)) {
      issues.push({
        stepKey: step.key,
        message: `L'heure imposée du palier « ${step.key} » doit être au format HH:MM.`,
      });
    }

    if (step.catchUpDays != null && (!Number.isInteger(step.catchUpDays) || step.catchUpDays < 0)) {
      issues.push({
        stepKey: step.key,
        message: `Le rattrapage du palier « ${step.key} » doit être un entier positif de jours.`,
      });
    }
  }

  // RG-M10-03 : offsets strictement croissants dans l'ordre affiché, à l'intérieur d'un même
  // groupe d'ancre (un palier « EXPIRE » ancré sur validUntil n'est pas comparé aux paliers
  // ancrés sur sentAt/par défaut, cf. US-M10-07 et l'exemple « Suivi de devis »).
  const groups = new Map<string, number[]>();
  steps.forEach((step, index) => {
    const anchor = step.anchor ?? "default";
    const group = groups.get(anchor) ?? [];
    group.push(index);
    groups.set(anchor, group);
  });
  for (const indices of groups.values()) {
    for (let i = 1; i < indices.length; i += 1) {
      const prev = steps[indices[i - 1] as number] as ReminderStep;
      const curr = steps[indices[i] as number] as ReminderStep;
      if (curr.offsetDays <= prev.offsetDays) {
        issues.push({
          stepKey: curr.key,
          message: `Les paliers doivent être dans l'ordre croissant : « ${curr.key} » (${curr.offsetDays}) doit venir après « ${prev.key} » (${prev.offsetDays}).`,
        });
      }
    }
  }

  return issues;
}

/** Variante qui lève une `DomainError` sur la première violation (RG-M10-03/06). */
export function validateSteps(steps: readonly ReminderStep[]): void {
  const issues = collectStepIssues(steps);
  if (issues.length > 0) {
    throw new DomainError("reminders.invalid_steps", (issues[0] as StepValidationIssue).message, {
      issues,
    });
  }
}

/**
 * Résultat d'une modification de frise (US-M10-07) : les paliers déjà envoyés dans des séquences
 * en cours ne sont jamais rattrapés rétroactivement (RG-M10-06) ; seules les occurrences futures
 * tiendront compte du nouveau palier.
 */
export function describeStepsChange(
  previousSteps: readonly ReminderStep[],
  nextSteps: readonly ReminderStep[],
): { added: string[]; removed: string[]; changed: string[] } {
  const previousByKey = new Map(previousSteps.map((s) => [s.key, s]));
  const nextByKey = new Map(nextSteps.map((s) => [s.key, s]));

  const added = nextSteps.filter((s) => !previousByKey.has(s.key)).map((s) => s.key);
  const removed = previousSteps.filter((s) => !nextByKey.has(s.key)).map((s) => s.key);
  const changed = nextSteps
    .filter((s) => {
      const prev = previousByKey.get(s.key);
      return prev && JSON.stringify(prev) !== JSON.stringify(s);
    })
    .map((s) => s.key);

  return { added, removed, changed };
}
