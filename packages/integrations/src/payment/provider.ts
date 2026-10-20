import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

/** Moyens payables en ligne (sous-ensemble de `PaymentMethod`, M08 RG-M08-18). */
export type OnlinePaymentMethod = "WAVE" | "ORANGE_MONEY" | "MTN_MOMO" | "MOOV_MONEY" | "CARD";

export interface CreatePaymentLinkInput {
  invoiceId: string;
  /** Numéro lisible (FAC-2026-000412), repris dans la référence fournisseur. */
  reference?: string;
  amount: number;
  /** Moyen choisi sur le portail ; null = au choix du client chez le fournisseur. */
  method?: OnlinePaymentMethod | null;
  customer: { name: string; phone?: string; email?: string };
  expiresAt: Date;
  description?: string;
  /** Page où revient le client après paiement (page facture du portail). */
  returnUrl?: string;
  /** Webhook `POST /api/webhooks/payments/[provider]/[organizationId]`. */
  notifyUrl?: string;
}

export interface CreatePaymentLinkResult {
  url: string;
  providerRef: string;
}

/** Statut tel que confirmé par le fournisseur (`getStatus`), seule source de vérité (RG-M08-24). */
export interface PaymentStatusResult {
  status: PaymentStatus;
  /** Montant réellement payé (FCFA entiers) ; null si inconnu. */
  amount: number | null;
  method: OnlinePaymentMethod | null;
  paidAt: Date | null;
  payerPhone: string | null;
}

export interface PaymentEvent extends PaymentStatusResult {
  providerRef: string;
  raw: unknown;
}

/**
 * 01-architecture-technique.md §10 — CinetPay, Wave Business, simulateur. Le webhook n'est
 * jamais cru seul : l'appelant vérifie la signature, lit la référence, puis confirme statut
 * et montant avec `getStatus` (RG-M08-24).
 */
export interface PaymentProvider {
  readonly name: string;
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult>;
  /** Vérifie la signature du corps brut (comparaison à temps constant). */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent;
  getStatus(providerRef: string): Promise<PaymentStatusResult>;
}

/** Erreur fournisseur sans secret dans le message (affichable au conseiller). */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Compare deux signatures hexadécimales à temps constant. */
export function safeEqualHex(expected: string, received: string | null | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const PAYMENT_TIMEOUT_MS = 15_000;

export async function providerFetch(
  fetchImpl: FetchLike,
  label: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS) });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError" ? "délai dépassé" : "réseau";
    throw new PaymentProviderError(`${label} injoignable (${reason}).`, true);
  }
}

export function unpaidStatus(status: PaymentStatus): PaymentStatusResult {
  return { status, amount: null, method: null, paidAt: null, payerPhone: null };
}
