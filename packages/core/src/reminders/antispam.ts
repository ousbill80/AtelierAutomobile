import { differenceInCalendarDays } from "date-fns";
import type { ReminderType } from "./types";

// ───────────────────────── RG-M10-16 — priorités ─────────────────────────

/** RG-M10-16 — `0` = hors plafond (transactionnel) ; `7` = la moins prioritaire. */
export type ReminderPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** `"J+30"` → `30`, `"J-7"` → `-7`, `"J0"` → `0` ; `null` si la clé n'a pas ce format (ex. `"PROMISE_BROKEN"`). */
function parseStepOffset(stepKey: string): number | null {
  const match = /^J([+-]?\d+)$/.exec(stepKey);
  if (!match) return null;
  return Number(match[1]);
}

/**
 * RG-M10-16 — priorité d'une relance (1 = plus prioritaire). `0` pour les types transactionnels,
 * hors plafond anti-spam.
 */
export function priorityOf(type: ReminderType, stepKey: string): ReminderPriority {
  if (type === "APPOINTMENT" || type === "VEHICLE_READY") return 0;

  if (type === "RECEIVABLE") {
    if (stepKey === "PROMISE_BROKEN") return 1;
    const offset = parseStepOffset(stepKey);
    return offset !== null && offset >= 30 ? 1 : 3;
  }

  if (type === "INSPECTION") {
    return stepKey === "J0" || stepKey === "J+7" ? 2 : 4;
  }

  if (type === "QUOTE_FOLLOWUP") return 4;
  if (type === "SERVICE") return 5;
  if (type === "INSURANCE_EXPIRY") return 6;
  // SATISFACTION
  return 7;
}

/** `true` si la priorité est hors plafond anti-spam (messages transactionnels, RG-M10-16). */
export function isTransactionalPriority(priority: ReminderPriority): boolean {
  return priority === 0;
}

/** Parmi un groupe de relances dues le même jour, celle qu'il faut reporter en premier si le plafond est atteint. */
export function leastPriorityReminder<T extends { priority: ReminderPriority }>(
  reminders: readonly T[],
): T | null {
  if (reminders.length === 0) return null;
  return reminders.reduce((worst, r) => (r.priority > worst.priority ? r : worst));
}

// ───────────────────────── RG-M10-16 — plafonds ─────────────────────────

export interface AntiSpamSentEntry {
  recipientKey: string;
  sentAt: Date;
  priority: ReminderPriority;
}

export interface AntiSpamConfig {
  /** `settings.reminders.maxPerDay`, défaut 1. */
  maxPerDay?: number;
  /** `settings.reminders.maxPerWeek`, défaut 3 (fenêtre glissante de 7 jours). */
  maxPerWeek?: number;
}

export const DEFAULT_MAX_PER_DAY = 1;
export const DEFAULT_MAX_PER_WEEK = 3;

/**
 * RG-M10-16 — pour les messages non transactionnels : au plus `maxPerDay` par jour et `maxPerWeek`
 * par 7 jours glissants, par `recipientKey`. Les relances transactionnelles (priorité 0) sont
 * toujours autorisées.
 */
export function antiSpamAllows(
  recipientKey: string,
  priority: ReminderPriority,
  history: readonly AntiSpamSentEntry[],
  now: Date,
  cfg: AntiSpamConfig = {},
): boolean {
  if (isTransactionalPriority(priority)) return true;

  const maxPerDay = cfg.maxPerDay ?? DEFAULT_MAX_PER_DAY;
  const maxPerWeek = cfg.maxPerWeek ?? DEFAULT_MAX_PER_WEEK;

  const relevant = history.filter(
    (h) =>
      h.recipientKey === recipientKey &&
      !isTransactionalPriority(h.priority) &&
      h.sentAt.getTime() <= now.getTime(),
  );

  const sentToday = relevant.filter((h) => differenceInCalendarDays(now, h.sentAt) === 0).length;
  if (sentToday >= maxPerDay) return false;

  const sentThisWeek = relevant.filter((h) => differenceInCalendarDays(now, h.sentAt) < 7).length;
  if (sentThisWeek >= maxPerWeek) return false;

  return true;
}

// ───────────────────────── RG-M10-16 — report puis abandon ─────────────────────────

export interface AntiSpamCapDecision {
  action: "SNOOZED" | "SKIPPED";
  reason: string;
  snoozeCount: number;
}

/**
 * RG-M10-16 — si le plafond est atteint, la relance la moins prioritaire est reportée
 * (`SNOOZED`, motif « Plafond anti-spam ») ; après 3 reports, elle passe `SKIPPED`.
 */
export function applyAntiSpamCap(previousSnoozeCount: number): AntiSpamCapDecision {
  if (previousSnoozeCount >= 3) {
    return {
      action: "SKIPPED",
      reason: "Plafond anti-spam atteint trop longtemps",
      snoozeCount: previousSnoozeCount,
    };
  }
  return {
    action: "SNOOZED",
    reason: "Plafond anti-spam",
    snoozeCount: previousSnoozeCount + 1,
  };
}

// ───────────────────────── RG-M10-16 — restrictions SATISFACTION ─────────────────────────

export type SatisfactionBlockingCaseStatus = "OPEN" | "ESCALATED" | "DISPUTED" | "CLOSED";

/**
 * RG-M10-16 — `SATISFACTION` n'est jamais envoyée à un client ayant un dossier de recouvrement
 * `ESCALATED` ou `DISPUTED`, ni le même jour qu'une relance de créance.
 */
export function isSatisfactionBlocked(input: {
  collectionCaseStatus?: SatisfactionBlockingCaseStatus | null;
  hasReceivableReminderSameDay: boolean;
}): boolean {
  if (input.collectionCaseStatus === "ESCALATED" || input.collectionCaseStatus === "DISPUTED") {
    return true;
  }
  return input.hasReceivableReminderSameDay;
}
