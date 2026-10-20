// M08 RG-M08-23..25 / M14 RG-M14-03, 13..15 — liens de paiement mobile money : création ou
// réutilisation, montant confirmé par le fournisseur, rapprochement des liens en attente,
// affectation du paiement reçu, durée de vie du lien portail d'une facture.
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import type { PaymentMethodLike } from "./settings";

export const PAYMENT_LINK_DEFAULT_HOURS = 72;
export const PAYMENT_LINK_MAX_HOURS = 30 * 24;
/** RG-M08-25 : un lien expiré reste vérifié 24 h (paiement tardif) avant de passer `FAILED`. */
export const PAYMENT_LINK_GRACE_HOURS = 24;
/** RG-M14-15 : au-delà, la page facture prévient le client et le caissier. */
export const PAYMENT_CONFIRMATION_TIMEOUT_MS = 2 * 60_000;

/** Moyens payables en ligne (lien de paiement). */
export type OnlinePaymentMethodLike = "WAVE" | "ORANGE_MONEY" | "MTN_MOMO" | "MOOV_MONEY" | "CARD";

/** RG-M14-14 : ordre d'affichage des moyens sur le portail. */
export const PORTAL_METHOD_ORDER: readonly OnlinePaymentMethodLike[] = [
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CARD",
];

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const PAYABLE_STATUSES = new Set(["ISSUED", "PARTIALLY_PAID", "OVERDUE"]);

/** RG-M14-14 : une facture se paie en ligne si elle est émise, non soldée, ni annulée ni en litige. */
export function isInvoicePayable(invoice: { status: string; balance: number }): boolean {
  return invoice.balance > 0 && PAYABLE_STATUSES.has(invoice.status);
}

/** RG-M14-14 : union des moyens des fournisseurs actifs, dans l'ordre Wave, OM, MTN, Moov, Carte. */
export function portalPaymentMethods(
  configs: readonly { methods: readonly string[] }[],
): OnlinePaymentMethodLike[] {
  const offered = new Set(configs.flatMap((c) => c.methods));
  return PORTAL_METHOD_ORDER.filter((m) => offered.has(m));
}

export interface OpenPaymentLink {
  id: string;
  amount: number;
  status: string;
  expiresAt: Date;
  method: string | null;
}

export interface PlanPaymentLinkInput {
  invoice: { status: string; balance: number };
  /** Défaut : le solde (RG-M08-23, modifiable vers le bas). */
  amount?: number | null;
  expiresInHours?: number | null;
  method?: PaymentMethodLike | null;
  /** Portail : un lien en attente du même montant et du même moyen est réutilisé (RG-M14-14). */
  reuse: boolean;
  openLinks: readonly OpenPaymentLink[];
  now: Date;
}

export type PaymentLinkPlan =
  | { action: "reuse"; linkId: string }
  | { action: "create"; amount: number; expiresAt: Date; replaceIds: string[] };

function isActive(link: OpenPaymentLink, now: Date): boolean {
  return link.status === "PENDING" && link.expiresAt.getTime() > now.getTime();
}

/**
 * RG-M08-23 — montant ≤ solde, expiration 72 h par défaut ; un seul lien actif par facture et
 * par montant : un nouveau lien remplace (côté application) l'ancien du même montant.
 */
export function planPaymentLink(input: PlanPaymentLinkInput): PaymentLinkPlan {
  if (!isInvoicePayable(input.invoice)) {
    throw new DomainError(
      "payment_link.not_payable",
      "Cette facture n'a pas de solde à payer : aucun lien de paiement possible.",
    );
  }
  const amount = input.amount ?? input.invoice.balance;
  if (!Number.isInteger(amount) || amount <= 0 || amount > input.invoice.balance) {
    throw new DomainError(
      "payment_link.invalid_amount",
      `Le montant du lien doit être compris entre 1 FCFA et le solde (${formatFCFA(input.invoice.balance)}).`,
      { balance: input.invoice.balance },
    );
  }
  const hours = input.expiresInHours ?? PAYMENT_LINK_DEFAULT_HOURS;
  if (!Number.isInteger(hours) || hours < 1 || hours > PAYMENT_LINK_MAX_HOURS) {
    throw new DomainError(
      "payment_link.invalid_expiry",
      "La durée du lien doit être comprise entre 1 heure et 30 jours.",
    );
  }
  const sameAmount = input.openLinks.filter((l) => isActive(l, input.now) && l.amount === amount);
  if (input.reuse) {
    const method = input.method ?? null;
    const reusable = sameAmount.find((l) => (l.method ?? null) === method);
    if (reusable) return { action: "reuse", linkId: reusable.id };
  }
  return {
    action: "create",
    amount,
    expiresAt: new Date(input.now.getTime() + hours * HOUR_MS),
    replaceIds: sameAmount.map((l) => l.id),
  };
}

export type ProviderLinkStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export type PaymentLinkCheck =
  | { action: "confirm"; amount: number; mismatch: boolean }
  | { action: "fail"; reason: "failed" | "expired" }
  | { action: "keep" };

/**
 * RG-M08-24/25 — décision après `getStatus` : payé → confirmer le montant **réellement**
 * confirmé (écart signalé) ; échec → `FAILED` ; en attente → conservé jusqu'à 24 h après
 * l'expiration, puis `FAILED` (expiré sans paiement).
 */
export function checkPaymentLink(input: {
  link: { amount: number; expiresAt: Date };
  provider: { status: ProviderLinkStatus; amount?: number | null };
  now: Date;
}): PaymentLinkCheck {
  const { link, provider, now } = input;
  if (provider.status === "PAID") {
    const amount = provider.amount ?? link.amount;
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new DomainError(
        "payment_link.invalid_confirmed_amount",
        "Montant confirmé par le fournisseur invalide.",
      );
    }
    return { action: "confirm", amount, mismatch: amount !== link.amount };
  }
  if (provider.status === "FAILED") return { action: "fail", reason: "failed" };
  const graceEnd = link.expiresAt.getTime() + PAYMENT_LINK_GRACE_HOURS * HOUR_MS;
  if (provider.status === "EXPIRED" || now.getTime() >= graceEnd) {
    return { action: "fail", reason: "expired" };
  }
  return { action: "keep" };
}

/** Liens à rapprocher : en attente, non expirés ou expirés depuis moins de 24 h (RG-M08-25). */
export function reconcileWindowStart(now: Date): Date {
  return new Date(now.getTime() - PAYMENT_LINK_GRACE_HOURS * HOUR_MS);
}

/**
 * RG-M08-24 (5) — un paiement de lien est affecté à la facture du lien, plafonné à son solde ;
 * le reste est un trop-perçu (`unallocated`). Facture déjà soldée → « paiement en double probable ».
 */
export function linkPaymentAllocation(input: { amount: number; invoiceBalance: number }): {
  allocated: number;
  unallocated: number;
  probableDuplicate: boolean;
} {
  const allocated = Math.max(0, Math.min(input.amount, input.invoiceBalance));
  return {
    allocated,
    unallocated: input.amount - allocated,
    probableDuplicate: input.invoiceBalance <= 0,
  };
}

export function paymentMismatchMessage(linkAmount: number, confirmed: number): string {
  return `Montant reçu ${formatFCFA(confirmed)} différent du lien (${formatFCFA(linkAmount)}) : vérifiez le paiement.`;
}

/** RG-M14-03 — lien portail d'une facture : 180 j après émission, ou 30 j après paiement complet. */
export function invoicePortalExpiry(input: { issuedAt: Date; paidAt?: Date | null }): Date {
  if (input.paidAt) return new Date(input.paidAt.getTime() + 30 * DAY_MS);
  return new Date(input.issuedAt.getTime() + 180 * DAY_MS);
}

/** RG-M14-15 : 2 min sans confirmation après le clic « Payer ». */
export function isConfirmationOverdue(clickedAt: Date, now: Date): boolean {
  return now.getTime() - clickedAt.getTime() >= PAYMENT_CONFIRMATION_TIMEOUT_MS;
}

/** US-M08-14 / RG-M08-16 — une facture s'envoie une fois émise ; certification exigée si paramétré. */
export function invoiceSendBlocker(input: {
  status: string;
  fneStatus: string;
  blockSendUntilCertified: boolean;
}): string | null {
  if (input.status === "DRAFT") return "Émettez la facture avant de l'envoyer.";
  if (input.status === "VOID") return "Cette facture est annulée : elle ne peut plus être envoyée.";
  if (
    input.blockSendUntilCertified &&
    !["CERTIFIED", "MANUAL", "NOT_REQUIRED"].includes(input.fneStatus)
  ) {
    return "La facture n'est pas encore certifiée FNE : l'envoi au client est bloqué par vos paramètres.";
  }
  return null;
}

/** Reçu envoyé au client après un paiement de lien confirmé (RG-M08-24 étape 7). */
export function paymentReceiptMessage(input: {
  garageName: string;
  paymentNumber: string;
  amount: number;
  invoiceNumber: string | null;
  balanceAfter: number;
}): string {
  const invoice = input.invoiceNumber ? ` pour la facture ${input.invoiceNumber}` : "";
  const rest =
    input.balanceAfter > 0
      ? `Reste à payer : ${formatFCFA(input.balanceAfter)}.`
      : "Votre facture est soldée. Merci !";
  return `${input.garageName} — reçu ${input.paymentNumber} : ${formatFCFA(input.amount)} reçus${invoice}. ${rest}`;
}

/** US-M08-09 / US-M08-14 — message d'envoi de la facture (lien portail, lien de paiement). */
export function invoiceSendMessage(input: {
  customerName: string;
  garageName: string;
  invoiceNumber: string;
  total: number;
  balance: number;
  portalUrl: string | null;
  paymentUrl?: string | null;
}): string {
  const lines = [
    `Bonjour ${input.customerName},`,
    `Votre facture ${input.invoiceNumber} de ${formatFCFA(input.total)} est disponible.`,
  ];
  if (input.portalUrl)
    lines.push(`Consultez-la${input.balance > 0 ? " et payez-la" : ""} ici : ${input.portalUrl}`);
  if (input.balance > 0 && input.paymentUrl) {
    lines.push(`Payer ${formatFCFA(input.balance)} par mobile money : ${input.paymentUrl}`);
  } else if (input.balance > 0) {
    lines.push(`Reste à payer : ${formatFCFA(input.balance)}.`);
  }
  lines.push(input.garageName);
  return lines.join("\n");
}
