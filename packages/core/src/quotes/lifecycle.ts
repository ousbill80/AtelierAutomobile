// M05 §5 — machine à états du devis, gardes d'envoi (RG-M05-15), validité et expiration
// (RG-M05-08), lien public (RG-M05-09).
import { DomainError } from "../errors";
import { addDays } from "../reminders/dates";
import type { QuoteSettings } from "./settings";
import type { QuoteStatus } from "./types";

export const QUOTE_TRANSITIONS = [
  "send",
  "view",
  "decide",
  "expire",
  "edit",
  "convert",
  "delete",
] as const;
export type QuoteTransition = (typeof QUOTE_TRANSITIONS)[number];

export interface QuoteStateLike {
  status: QuoteStatus;
  sentAt?: Date | null;
  supersededAt?: Date | null;
  deletedAt?: Date | null;
}

const FROM: Record<QuoteTransition, readonly QuoteStatus[]> = {
  send: ["DRAFT"],
  view: ["SENT"],
  decide: ["DRAFT", "SENT", "VIEWED"],
  expire: ["SENT", "VIEWED"],
  edit: ["SENT", "VIEWED", "EXPIRED"],
  convert: ["ACCEPTED", "PARTIALLY_ACCEPTED"],
  delete: ["DRAFT"],
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  VIEWED: "Vu par le client",
  ACCEPTED: "Accepté",
  PARTIALLY_ACCEPTED: "Partiellement accepté",
  DECLINED: "Refusé",
  EXPIRED: "Expiré",
  CONVERTED: "Converti",
};

export type QuoteTransitionResult = { ok: true } | { ok: false; code: string; message: string };

export function canQuoteTransition(
  quote: QuoteStateLike,
  transition: QuoteTransition,
): QuoteTransitionResult {
  if (quote.deletedAt) return { ok: false, code: "DELETED", message: "Ce devis a été supprimé." };
  if (quote.supersededAt) {
    return {
      ok: false,
      code: "SUPERSEDED",
      message: "Cette version est remplacée par une plus récente : elle est en lecture seule.",
    };
  }
  if (!FROM[transition].includes(quote.status)) {
    return {
      ok: false,
      code: "INVALID_FROM_STATUS",
      message: `Action impossible : le devis est « ${QUOTE_STATUS_LABELS[quote.status]} ».`,
    };
  }
  if (transition === "delete" && quote.sentAt) {
    return {
      ok: false,
      code: "ALREADY_SENT",
      message: "Un devis envoyé ne se supprime jamais : créez une nouvelle version.",
    };
  }
  return { ok: true };
}

export function assertQuoteTransition(quote: QuoteStateLike, transition: QuoteTransition): void {
  const r = canQuoteTransition(quote, transition);
  if (!r.ok) throw new DomainError(r.code, r.message);
}

/** Le devis se modifie en place (brouillon courant jamais envoyé, RG-M05-15). */
export function isQuoteEditable(quote: QuoteStateLike): boolean {
  return quote.status === "DRAFT" && !quote.supersededAt && !quote.deletedAt;
}

export interface SendGuardInput {
  lineCount: number;
  total: number;
  /** Toutes les lignes sont garantie / interne (envoi « pour information »). */
  onlyNonBillable: boolean;
  discountApprovalStatus?: string | null;
}

/** RG-M05-15 — conditions d'envoi. */
export function sendBlockers(input: SendGuardInput): string[] {
  const reasons: string[] = [];
  if (input.lineCount === 0) reasons.push("Ajoutez au moins une ligne au devis.");
  else if (input.total <= 0 && !input.onlyNonBillable) {
    reasons.push("Le total du devis doit être supérieur à 0 FCFA.");
  }
  if (input.discountApprovalStatus === "PENDING") {
    reasons.push("Remise en attente de validation par le chef d'atelier.");
  }
  if (input.discountApprovalStatus === "REJECTED") {
    reasons.push("Remise refusée : ramenez-la dans votre plafond.");
  }
  return reasons;
}

/** RG-M05-08 — validité par défaut selon le type de client et l'origine. */
export function defaultValidUntil(
  today: Date,
  input: { customerType?: string | null; isInsurance?: boolean },
  settings: Pick<QuoteSettings, "validityDays" | "validityDaysCompany">,
): Date {
  const days =
    input.isInsurance || input.customerType === "COMPANY"
      ? settings.validityDaysCompany
      : settings.validityDays;
  return addDays(today, days);
}

/** Prix garantis jusqu'à `validUntil` inclus : expiré si `validUntil < aujourd'hui`. */
export function isPastValidity(validUntil: Date, today: Date): boolean {
  return validUntil.getTime() < today.getTime();
}

/** Job `quotes.expire` : SENT/VIEWED dont la validité est dépassée → EXPIRED. */
export function shouldExpire(quote: QuoteStateLike & { validUntil: Date }, today: Date): boolean {
  return (
    (quote.status === "SENT" || quote.status === "VIEWED") &&
    !quote.supersededAt &&
    !quote.deletedAt &&
    isPastValidity(quote.validUntil, today)
  );
}

/** RG-M05-09 / RG-M14-03 — le lien se lit jusqu'à `validUntil + 30 j`. */
export function portalLinkExpiry(validUntil: Date): Date {
  return addDays(validUntil, 31); // fin de la journée validUntil + 30 j
}

/** Montant à partir duquel la signature est toujours exigée (§11). */
export const SIGNATURE_ALWAYS_REQUIRED_FROM = 1_000_000;

export function signatureRequired(requireSignature: boolean, total: number): boolean {
  return requireSignature || total >= SIGNATURE_ALWAYS_REQUIRED_FROM;
}

/** Robots d'aperçu de lien (WhatsApp, Facebook…) : ignorés pour `VIEWED` (§5). */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|linkedinbot|discordbot|skypeuripreview|googlebot|bingbot|bot\b|crawler|spider|preview/i.test(
    userAgent,
  );
}
