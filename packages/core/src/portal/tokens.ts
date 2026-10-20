// M14 §4.1 — jetons du portail : portées (RG-M14-02), expiration par portée (RG-M14-03),
// renouvellement (« Recevoir un nouveau lien ») et alias court SMS (RG-M14-05).
import { portalLinkExpiry } from "../quotes/lifecycle";
import { invoicePortalExpiry } from "../billing/paymentLinks";
import type { Permission } from "../auth/permissions";

export const PORTAL_SCOPES = [
  "QUOTE",
  "INVOICE",
  "REPAIR_ORDER",
  "APPOINTMENT",
  "BOOKING",
  "VEHICLE",
  "STATEMENT",
  "SURVEY",
] as const;
export type PortalScopeKey = (typeof PORTAL_SCOPES)[number];

const DAY_MS = 86_400_000;

/** RG-M14-01 : 32 octets en base64url = 43 caractères. */
export const PORTAL_TOKEN_LENGTH = 43;
/** RG-M14-05 : alias court de 8 caractères base62. */
export const SHORT_CODE_LENGTH = 8;
export const SHORT_CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Forme d'un jeton (avant toute lecture en base) : base64url, 32 à 64 caractères. */
export function isPortalTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{32,64}$/.test(token);
}

export function isShortCodeShape(code: string): boolean {
  return new RegExp(`^[0-9A-Za-z]{${SHORT_CODE_LENGTH}}$`).test(code);
}

/** Convertit des octets aléatoires (fournis par l'appelant) en alias base62. */
export function shortCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < SHORT_CODE_LENGTH) throw new Error("Pas assez d'octets pour l'alias.");
  let out = "";
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    out += SHORT_CODE_ALPHABET[bytes[i]! % SHORT_CODE_ALPHABET.length];
  }
  return out;
}

export interface PortalExpiryRefs {
  now: Date;
  /** QUOTE : `Quote.validUntil`. */
  validUntil?: Date | null;
  /** INVOICE : date d'émission et de paiement complet. */
  issuedAt?: Date | null;
  paidAt?: Date | null;
  /** REPAIR_ORDER : `RepairOrder.deliveredAt`. */
  deliveredAt?: Date | null;
  /** APPOINTMENT : `Appointment.startsAt`. */
  startsAt?: Date | null;
}

/** Tant qu'un OR n'est pas restitué, son lien de suivi reste valable 90 jours (prolongé à la restitution). */
export const REPAIR_ORDER_OPEN_DAYS = 90;

/** RG-M14-03 — expiration par défaut d'un jeton selon sa portée. */
export function portalTokenExpiry(scope: PortalScopeKey, refs: PortalExpiryRefs): Date {
  const plus = (base: Date, days: number) => new Date(base.getTime() + days * DAY_MS);
  switch (scope) {
    case "QUOTE":
      return refs.validUntil ? portalLinkExpiry(refs.validUntil) : plus(refs.now, 30);
    case "INVOICE":
      return invoicePortalExpiry({ issuedAt: refs.issuedAt ?? refs.now, paidAt: refs.paidAt });
    case "REPAIR_ORDER":
      return refs.deliveredAt ? plus(refs.deliveredAt, 30) : plus(refs.now, REPAIR_ORDER_OPEN_DAYS);
    case "APPOINTMENT":
      // Aligné sur M03 (lien valable jusqu'à 7 j après le RDV, déjà en place) ; M14 dit + 1 j.
      return refs.startsAt ? plus(refs.startsAt, 7) : plus(refs.now, 30);
    case "BOOKING":
      return plus(refs.now, 30);
    case "VEHICLE":
    case "STATEMENT":
      return plus(refs.now, 90);
    case "SURVEY":
      return plus(refs.now, 14);
  }
}

/**
 * Un lien renvoyé à la demande du client (« Recevoir un nouveau lien ») reste lisible au moins
 * 7 jours, même si l'échéance de sa ressource est passée (devis échu : lecture seule).
 */
export const RENEWED_LINK_MIN_DAYS = 7;

export function renewedTokenExpiry(scope: PortalScopeKey, refs: PortalExpiryRefs): Date {
  const regular = portalTokenExpiry(scope, refs);
  const floor = new Date(refs.now.getTime() + RENEWED_LINK_MIN_DAYS * DAY_MS);
  return regular.getTime() > floor.getTime() ? regular : floor;
}

/** RG-M14-03 : 3 demandes de nouveau lien par jour (par client et par ressource). */
export const NEW_LINK_REQUESTS_PER_DAY = 3;

export function canRequestNewLink(requestsLast24h: number): boolean {
  return requestsLast24h < NEW_LINK_REQUESTS_PER_DAY;
}

export type PortalTokenState = "ACTIVE" | "EXPIRED" | "REVOKED";

/** État effectif d'un jeton (une date passée l'emporte sur un statut ACTIVE non encore balayé). */
export function effectiveTokenState(
  token: { status: PortalTokenState; expiresAt: Date },
  now: Date,
): PortalTokenState {
  if (token.status === "REVOKED") return "REVOKED";
  if (token.status === "EXPIRED" || token.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "ACTIVE";
}

/** Chemin de la page cible d'une portée sous `/p/{token}` (aiguillage de `/p/[token]`). */
export function portalPathFor(scope: PortalScopeKey): string {
  switch (scope) {
    case "QUOTE":
      return "devis";
    case "INVOICE":
      return "facture";
    case "REPAIR_ORDER":
      return "suivi";
    case "APPOINTMENT":
    case "BOOKING":
      return "rdv";
    case "VEHICLE":
      return "vehicule";
    case "STATEMENT":
      return "releve";
    case "SURVEY":
      return "avis";
  }
}

/** Purge du journal des accès (M14 §9) : 12 mois. */
export const PORTAL_ACCESS_RETENTION_DAYS = 365;

export function portalAccessPurgeBefore(now: Date): Date {
  return new Date(now.getTime() - PORTAL_ACCESS_RETENTION_DAYS * DAY_MS);
}

/** M14 §10 — permissions du bloc « Lien client » selon la portée (lecture / création-envoi-révocation). */
export function portalLinkPermissions(scope: PortalScopeKey): {
  read: Permission[];
  write: Permission[];
} {
  switch (scope) {
    case "QUOTE":
      return { read: ["quote:read"], write: ["quote:send"] };
    case "INVOICE":
    case "STATEMENT":
      return { read: ["invoice:read"], write: ["invoice:read", "message:send"] };
    case "APPOINTMENT":
    case "BOOKING":
      return { read: ["appointment:create"], write: ["appointment:create", "message:send"] };
    case "REPAIR_ORDER":
    case "VEHICLE":
    case "SURVEY":
      return { read: ["repair_order:read"], write: ["repair_order:read", "message:send"] };
  }
}
