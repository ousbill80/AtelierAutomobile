import type { Weekday } from "../calendar";

/**
 * Types de relance couverts par cette tranche (M10 RG-M10-01). `RECOMMENDED_WORK` et `CUSTOM`
 * (arbitrage A8, docs/04-arbitrages-coherence.md) seront ajoutés avec le module qui les alimente.
 */
export type ReminderType =
  | "INSPECTION"
  | "SERVICE"
  | "RECEIVABLE"
  | "APPOINTMENT"
  | "QUOTE_FOLLOWUP"
  | "VEHICLE_READY"
  | "INSURANCE_EXPIRY"
  | "SATISFACTION";

export type ReminderChannel = "WHATSAPP" | "SMS" | "EMAIL";

/** Machine à états de 02-modele-donnees.md / M10 §5.1. */
export type ReminderStatus =
  "PLANNED" | "NEEDS_APPROVAL" | "QUEUED" | "SENT" | "FAILED" | "SKIPPED" | "SNOOZED" | "CANCELLED";

/** RG-M10-03 : ancre utilisée par un palier quand elle diffère de l'ancre par défaut du type. */
export type StepAnchorMode = "default" | "sentAt" | "validUntil";

export type ReminderAttachment = "statement" | "formal_notice" | "invoice";

/** RG-M10-03 — schéma d'un palier de `ReminderRule.steps[]`, version TypeScript pure (pas de Zod ici). */
export interface ReminderStep {
  /** `/^[A-Z0-9+\-_]{1,16}$/`, ex. "J-30", "J+15", "H-2", "CONFIRM", "EXPIRE". */
  key: string;
  label: string;
  /** Entier, [-365, 365]. */
  offsetDays: number;
  /** `APPOINTMENT` uniquement. */
  offsetHours?: number;
  anchor?: StepAnchorMode;
  templateKey: string;
  autoSend: boolean;
  channels: ReminderChannel[];
  /** Alerte gérant : pas de message client (RG-M10-03, §5.2). */
  internalOnly?: boolean;
  requiresPermission?: string;
  attachments?: ReminderAttachment[];
  catchUpDays?: number;
  /** `"HH:MM"`, heure imposée (ex. J-1 RDV à 17:00). */
  sendAt?: string;
}

/** RG-M10-09 — fenêtre d'envoi d'une règle. `days` = jours ouverts (convention ISO%7 de `core/calendar` : 0 = dimanche). */
export interface SendWindow {
  days: Weekday[];
  /** `"HH:MM"`. */
  from: string;
  /** `"HH:MM"`. */
  to: string;
  /** `"HH:MM"`. */
  preferredTime: string;
}

export interface ReminderRuleDefinition {
  type: ReminderType;
  steps: ReminderStep[];
  sendWindow: SendWindow;
  stopOn: string[];
  /** Défaut organisation si absent : voir `DEFAULT_MIN_GAP_DAYS` / `DEFAULT_CATCH_UP_DAYS`. */
  minGapDays?: number;
  catchUpDays?: number;
}

/** RG-M10-07 — écart minimal par défaut entre deux envois d'une même séquence. */
export const DEFAULT_MIN_GAP_DAYS = 3;

/** RG-M10-06 — fenêtre de rattrapage par défaut du dernier palier d'une séquence. */
export const DEFAULT_CATCH_UP_DAYS = 7;

/** RG-M10-04 — montant minimum par défaut sous lequel une créance n'est pas relancée. */
export const DEFAULT_MIN_RECEIVABLE_AMOUNT = 2000;

/** RG-M10-04 — étiquettes exclues par défaut. */
export const DEFAULT_EXCLUDE_TAGS = ["vip-sans-relance"];

/** RG-M10-04 — types transactionnels, exemptés du consentement/`doNotRemind`/`OptOut`. */
export const TRANSACTIONAL_REMINDER_TYPES: ReadonlySet<ReminderType> = new Set([
  "APPOINTMENT",
  "VEHICLE_READY",
]);
