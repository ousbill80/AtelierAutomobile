import {
  hmacSha256Hex,
  PaymentProviderError,
  providerFetch,
  safeEqualHex,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkResult,
  type FetchLike,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentStatusResult,
} from "./provider";

export interface WaveCredentials {
  apiKey: string;
  /** Secret de signature des webhooks (en-tête `Wave-Signature`). */
  webhookSecret: string;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://api.wave.com";

interface WaveSession {
  id?: string;
  amount?: string | number;
  checkout_status?: string;
  payment_status?: string;
  when_completed?: string | null;
  wave_launch_url?: string;
}

function statusOf(session: WaveSession): PaymentStatus {
  if (session.payment_status === "succeeded") return "PAID";
  if (session.checkout_status === "expired") return "EXPIRED";
  if (session.payment_status === "cancelled") return "FAILED";
  return "PENDING";
}

function sessionResult(session: WaveSession): PaymentStatusResult {
  const status = statusOf(session);
  const amount = Number(session.amount);
  const paidAt = session.when_completed ? new Date(session.when_completed) : null;
  return {
    status,
    amount: status === "PAID" && Number.isInteger(amount) && amount > 0 ? amount : null,
    method: status === "PAID" ? "WAVE" : null,
    paidAt: paidAt && !Number.isNaN(paidAt.getTime()) ? paidAt : null,
    payerPhone: null,
  };
}

/**
 * Adaptateur Wave Business (« Checkout API ») : session de paiement, statut, webhook signé
 * `Wave-Signature: t=<horodatage>,v1=<hmac(secret, horodatage + corps)>`. Gabarit à valider
 * avec le compte marchand ; les clés n'apparaissent jamais dans les messages d'erreur.
 */
export class WaveProvider implements PaymentProvider {
  readonly name = "wave";

  constructor(
    private readonly credentials: WaveCredentials,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string): string {
    return `${(this.credentials.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}${path}`;
  }

  private async request(path: string, init: RequestInit): Promise<WaveSession> {
    const response = await providerFetch(this.fetchImpl, "Wave", this.url(path), {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.credentials.apiKey}`,
      },
    });
    if (response.status >= 500 || response.status === 429) {
      throw new PaymentProviderError(`Wave indisponible (HTTP ${response.status}).`, true);
    }
    const json = (await response.json().catch(() => null)) as
      (WaveSession & { message?: string }) | null;
    if (!response.ok || !json) {
      throw new PaymentProviderError(
        `Wave a refusé la demande (${json?.message ?? `HTTP ${response.status}`}).`,
        false,
      );
    }
    return json;
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    const session = await this.request("/v1/checkout/sessions", {
      method: "POST",
      body: JSON.stringify({
        amount: String(input.amount),
        currency: "XOF",
        client_reference: (input.reference ?? input.invoiceId).slice(0, 255),
        success_url: input.returnUrl,
        error_url: input.returnUrl,
      }),
    });
    if (!session.id || !session.wave_launch_url) {
      throw new PaymentProviderError("Wave a répondu sans lien de paiement.", false);
    }
    return { url: session.wave_launch_url, providerRef: session.id };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const header = headers.get("wave-signature") ?? "";
    const parts = header.split(",").map((p) => p.trim());
    const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
    if (!timestamp) return false;
    const expected = hmacSha256Hex(this.credentials.webhookSecret, `${timestamp}${rawBody}`);
    return parts.filter((p) => p.startsWith("v1=")).some((p) => safeEqualHex(expected, p.slice(3)));
  }

  parseWebhook(rawBody: string): PaymentEvent {
    const body = JSON.parse(rawBody) as { data?: WaveSession };
    const session = body.data ?? {};
    return { providerRef: session.id ?? "", ...sessionResult(session), raw: body };
  }

  async getStatus(providerRef: string): Promise<PaymentStatusResult> {
    return sessionResult(
      await this.request(`/v1/checkout/sessions/${encodeURIComponent(providerRef)}`, {
        method: "GET",
      }),
    );
  }
}
