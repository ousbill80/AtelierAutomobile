import { randomBytes } from "node:crypto";
import {
  hmacSha256Hex,
  PaymentProviderError,
  providerFetch,
  safeEqualHex,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkResult,
  type FetchLike,
  type OnlinePaymentMethod,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentStatusResult,
} from "./provider";

export interface CinetPayCredentials {
  apiKey: string;
  siteId: string;
  /** Clé secrète de signature des notifications (en-tête `x-token`). */
  secretKey: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api-checkout.cinetpay.com";

/** Champs concaténés, dans cet ordre, pour le jeton HMAC `x-token` des notifications CinetPay. */
const TOKEN_FIELDS = [
  "cpm_site_id",
  "cpm_trans_id",
  "cpm_trans_date",
  "cpm_amount",
  "cpm_currency",
  "signature",
  "payment_method",
  "cel_phone_num",
  "cpm_phone_prefixe",
  "cpm_language",
  "cpm_version",
  "cpm_payment_config",
  "cpm_page_action",
  "cpm_custom",
  "cpm_designation",
  "cpm_error_message",
] as const;

/** `payment_method` CinetPay → moyen AtelierOS. */
export function cinetPayMethod(code: string | null | undefined): OnlinePaymentMethod | null {
  const value = (code ?? "").toUpperCase();
  if (value.startsWith("WAVE")) return "WAVE";
  if (value.startsWith("OM") || value.includes("ORANGE")) return "ORANGE_MONEY";
  if (value.startsWith("MOMO") || value.includes("MTN")) return "MTN_MOMO";
  if (value.startsWith("FLOOZ") || value.includes("MOOV")) return "MOOV_MONEY";
  if (value.startsWith("VISA") || value.includes("CARD") || value.startsWith("MASTER"))
    return "CARD";
  return null;
}

function channelsFor(method: OnlinePaymentMethod | null | undefined): string {
  if (method === "CARD") return "CREDIT_CARD";
  if (method) return "MOBILE_MONEY";
  return "ALL";
}

function statusOf(value: unknown): PaymentStatus {
  if (value === "ACCEPTED") return "PAID";
  if (value === "REFUSED" || value === "CANCELED" || value === "CANCELLED") return "FAILED";
  return "PENDING";
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts.slice(1).join(" ") || parts[0] || "Client", last: parts[0] || "Client" };
}

/**
 * Adaptateur CinetPay (agrégateur Wave / Orange Money / MTN / Moov / carte). Gabarit de l'API
 * « Checkout v2 » : à valider avec le compte marchand du garage pilote ; le reste de
 * l'application ne dépend que de {@link PaymentProvider}. Les clés n'apparaissent jamais dans
 * les messages d'erreur.
 */
export class CinetPayProvider implements PaymentProvider {
  readonly name = "cinetpay";

  constructor(
    private readonly credentials: CinetPayCredentials,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string): string {
    return `${(this.credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}${path}`;
  }

  private async post(path: string, body: Record<string, unknown>) {
    const response = await providerFetch(this.fetchImpl, "CinetPay", this.url(path), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        apikey: this.credentials.apiKey,
        site_id: this.credentials.siteId,
        ...body,
      }),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (response.status >= 500 || response.status === 429) {
      throw new PaymentProviderError(`CinetPay indisponible (HTTP ${response.status}).`, true);
    }
    return { status: response.status, json: json ?? {} };
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    // Référence unique côté CinetPay (≤ 50 caractères, sans caractère spécial).
    const base = (input.reference ?? input.invoiceId).replace(/[^A-Za-z0-9-]/g, "").slice(0, 30);
    const transactionId = `${base}-${randomBytes(6).toString("hex")}`;
    const name = splitName(input.customer.name);
    const { json } = await this.post("/v2/payment", {
      transaction_id: transactionId,
      amount: input.amount,
      currency: "XOF",
      description: (input.description ?? `Facture ${input.reference ?? ""}`).slice(0, 100),
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      channels: channelsFor(input.method),
      lang: "fr",
      customer_name: name.first,
      customer_surname: name.last,
      customer_phone_number: input.customer.phone?.replace(/^\+225/, "") ?? undefined,
      customer_email: input.customer.email ?? undefined,
    });
    const data = (json.data ?? {}) as Record<string, unknown>;
    if (json.code !== "201" || typeof data.payment_url !== "string") {
      throw new PaymentProviderError(
        `CinetPay a refusé la création du lien (${String(json.description ?? json.message ?? json.code ?? "réponse invalide")}).`,
        false,
      );
    }
    return { url: data.payment_url, providerRef: transactionId };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const form = new URLSearchParams(rawBody);
    const payload = TOKEN_FIELDS.map((f) => form.get(f) ?? "").join("");
    return safeEqualHex(hmacSha256Hex(this.credentials.secretKey, payload), headers.get("x-token"));
  }

  /** La notification ne porte que la référence : le statut est toujours relu par `getStatus`. */
  parseWebhook(rawBody: string): PaymentEvent {
    const form = new URLSearchParams(rawBody);
    const amount = Number(form.get("cpm_amount"));
    return {
      providerRef: form.get("cpm_trans_id") ?? "",
      status: "PENDING",
      amount: Number.isInteger(amount) && amount > 0 ? amount : null,
      method: cinetPayMethod(form.get("payment_method")),
      paidAt: null,
      payerPhone: form.get("cel_phone_num"),
      raw: Object.fromEntries(form),
    };
  }

  async getStatus(providerRef: string): Promise<PaymentStatusResult> {
    const { json } = await this.post("/v2/payment/check", { transaction_id: providerRef });
    const data = (json.data ?? {}) as Record<string, unknown>;
    const status = statusOf(data.status);
    const amount = Number(data.amount);
    const paidAt = typeof data.payment_date === "string" ? new Date(data.payment_date) : null;
    return {
      status,
      amount: Number.isInteger(amount) && amount > 0 ? amount : null,
      method: cinetPayMethod(typeof data.payment_method === "string" ? data.payment_method : null),
      paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
      payerPhone: typeof data.phone_number === "string" ? data.phone_number : null,
    };
  }
}
