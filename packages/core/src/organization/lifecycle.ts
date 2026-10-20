// M15 §5 et RG-M15-22 — cycle de vie de l'organisation (suppression programmée, purge) et
// RG-M15-27 (accès support). Fonctions pures, horloge injectée par l'appelant.

import { addDays } from "date-fns";
import { DomainError } from "../errors";

export type OrgLifecycleStatus = "ACTIVE" | "SUSPENDED" | "DELETION_SCHEDULED" | "PURGED";

/** Délai de grâce avant la purge (RG-M15-22). */
export const DELETION_GRACE_DAYS = 30;
/** Durée légale de conservation des factures émises (OHADA). */
export const INVOICE_RETENTION_YEARS = 10;
/** Durée maximale d'un accès support autorisé par l'OWNER (RG-M15-27). */
export const SUPPORT_ACCESS_MAX_HOURS = 24;

/** Lecture seule : suppression programmée ou compte suspendu (impayé d'abonnement). */
export function isReadOnlyLifecycle(status: OrgLifecycleStatus): boolean {
  return status !== "ACTIVE";
}

/** Envois automatiques, synchros et API suspendus hors état ACTIVE (RG-M15-22). */
export function automationsSuspended(status: OrgLifecycleStatus): boolean {
  return status !== "ACTIVE";
}

/**
 * Procédures tRPC encore autorisées en écriture pendant la lecture seule : annuler la
 * suppression, exporter ses données (et l'OTP qui les protège), changer d'offre est exclu.
 */
export const READ_ONLY_ALLOWED_MUTATIONS: readonly string[] = [
  "org.cancelDeletion",
  "org.sendSecurityCode",
  "dataExport.request",
];

export function isMutationAllowedInLifecycle(status: OrgLifecycleStatus, path: string): boolean {
  if (!isReadOnlyLifecycle(status)) return true;
  if (status === "PURGED") return false;
  return READ_ONLY_ALLOWED_MUTATIONS.includes(path);
}

export function readOnlyMessage(status: OrgLifecycleStatus): string {
  switch (status) {
    case "DELETION_SCHEDULED":
      return "Suppression du compte programmée : le garage est en lecture seule. Annulez la suppression dans Paramètres > Données pour modifier vos données.";
    case "SUSPENDED":
      return "Compte suspendu : le garage est en lecture seule. Contactez l'équipe AtelierOS.";
    case "PURGED":
      return "Ce compte a été supprimé.";
    default:
      return "";
  }
}

/** Normalisation pour comparer le nom saisi au nom du garage (casse, espaces, accents). */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface DeletionRequestInput {
  status: OrgLifecycleStatus;
  organizationName: string;
  confirmName: string;
  /** Factures FNE en attente de certification (M15 §11 : suppression refusée). */
  pendingFneInvoices: number;
  now: Date;
}

/** RG-M15-22 / US-M15-09 — vérifie la demande et calcule l'échéance (J+30). */
export function planDeletion(input: DeletionRequestInput): {
  requestedAt: Date;
  scheduledFor: Date;
} {
  if (input.status !== "ACTIVE") {
    throw new DomainError(
      "org.deletion_not_allowed",
      input.status === "DELETION_SCHEDULED"
        ? "Une suppression est déjà programmée."
        : "La suppression n'est possible que pour un compte actif.",
    );
  }
  if (normalizeName(input.confirmName) !== normalizeName(input.organizationName)) {
    throw new DomainError(
      "org.deletion_name_mismatch",
      `Saisissez exactement le nom du garage (« ${input.organizationName} ») pour confirmer.`,
    );
  }
  if (input.pendingFneInvoices > 0) {
    throw new DomainError(
      "org.deletion_fne_pending",
      `${input.pendingFneInvoices} facture(s) FNE sont en attente de certification : traitez-les avant de supprimer le compte.`,
      { pendingFneInvoices: input.pendingFneInvoices },
    );
  }
  return { requestedAt: input.now, scheduledFor: addDays(input.now, DELETION_GRACE_DAYS) };
}

export function assertCanCancelDeletion(status: OrgLifecycleStatus): void {
  if (status !== "DELETION_SCHEDULED") {
    throw new DomainError("org.no_deletion_scheduled", "Aucune suppression n'est programmée.");
  }
}

/** Organisation à purger : suppression programmée et échéance atteinte. */
export function isDueForPurge(
  org: { lifecycleStatus: OrgLifecycleStatus; deletionScheduledFor: Date | null },
  now: Date,
): boolean {
  return (
    org.lifecycleStatus === "DELETION_SCHEDULED" &&
    org.deletionScheduledFor !== null &&
    org.deletionScheduledFor.getTime() <= now.getTime()
  );
}

/** Libellé d'un client anonymisé : « Client supprimé #<hash> » (stable, non réversible). */
export function anonymizedCustomerName(customerId: string): string {
  return `Client supprimé #${shortHash(customerId)}`;
}

/** Hachage court déterministe (cyrb53) — `core` reste importable côté navigateur, sans node:crypto. */
function shortHash(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0").slice(0, 8);
}

/** RG-M15-27 — fin de l'accès support autorisé (borné à 24 h). */
export function supportAccessUntil(now: Date, hours: number): Date {
  if (!Number.isInteger(hours) || hours < 1 || hours > SUPPORT_ACCESS_MAX_HOURS) {
    throw new DomainError(
      "support.invalid_duration",
      `L'accès support est limité à ${SUPPORT_ACCESS_MAX_HOURS} h.`,
    );
  }
  return new Date(now.getTime() + hours * 3_600_000);
}

export function isSupportAccessActive(until: Date | null, now: Date): boolean {
  return until !== null && until.getTime() > now.getTime();
}
