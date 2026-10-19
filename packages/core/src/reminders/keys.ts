// RG-M10-05 (séquence/dédoublonnage), RG-M10-14/15 (destinataire/regroupement).
import { isoDateOnly } from "./dates";

export interface SequenceKeyInput {
  type: string;
  entityId: string;
  anchor: Date;
}

/** `"{TYPE}:{entityId}:{anchorISO}"`. */
export function buildSequenceKey({ type, entityId, anchor }: SequenceKeyInput): string {
  return `${type}:${entityId}:${isoDateOnly(anchor)}`;
}

/** `sequenceKey + ":" + stepKey`. */
export function buildDedupeKey(sequenceKey: string, stepKey: string): string {
  return `${sequenceKey}:${stepKey}`;
}

/** Relance de promesse rompue, hors séquence (RG-M10-05). */
export function buildPromiseBrokenDedupeKey(
  caseId: string,
  anchor: Date,
  promiseId: string,
): string {
  return `RECEIVABLE:${caseId}:${isoDateOnly(anchor)}:PROMISE_BROKEN:${promiseId}`;
}

/** Relance manuelle, hors séquence (RG-M10-05). `at` doit être l'horodatage d'envoi, pas `today`. */
export function buildManualDedupeKey(type: string, entityId: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `${type}:${entityId}:MANUAL:${stamp}`;
}

export type RecipientAddress = { kind: "phone"; e164: string } | { kind: "email"; address: string };

/**
 * RG-M10-14 — clé de destinataire indépendante de `customerId` : toutes les règles
 * anti-spam et de regroupement se calculent par adresse normalisée.
 */
export function buildRecipientKey(address: RecipientAddress): string {
  if (address.kind === "phone") return address.e164;
  return address.address.trim().toLowerCase();
}

export interface GroupKeyInput {
  recipientKey: string;
  type: string;
  stepKey: string;
  date: Date; // jour civil de l'envoi
}

/** `"{recipientKey}:{type}:{stepKey}:{yyyy-MM-dd}"` (RG-M10-15). */
export function buildGroupKey({ recipientKey, type, stepKey, date }: GroupKeyInput): string {
  return `${recipientKey}:${type}:${stepKey}:${isoDateOnly(date)}`;
}
