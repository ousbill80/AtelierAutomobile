import type { FneInvoicePayload } from "@atelieros/core";
import {
  FneProviderError,
  type FneCertifyResult,
  type FneHealthStatus,
  type FneProvider,
} from "./provider";

export interface DgiApiCredentials {
  /** URL de base communiquée par la DGI à l'inscription du garage. */
  baseUrl: string;
  apiKey: string;
  establishmentId?: string | null;
  pointOfSale?: string | null;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;

/**
 * Adaptateur `dgi_api` (RG-M08-14) : seul endroit du code qui connaît le format de l'API DGI.
 * La spécification officielle n'étant pas encore obtenue, la traduction ci-dessous est un
 * gabarit JSON à aligner sur le document DGI lors du branchement réel ; le reste de
 * l'application ne dépend que de `FneInvoicePayload` et `FneCertifyResult`.
 *
 * Erreurs : réseau, délai dépassé, 429 et 5xx → transitoires (reprise) ; autres 4xx → rejet.
 * Les identifiants ne sont jamais inclus dans les messages d'erreur.
 */
export class DgiApiFneProvider implements FneProvider {
  constructor(
    private readonly credentials: DgiApiCredentials,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private url(path: string): string {
    return `${this.credentials.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async request(path: string, init: RequestInit, idempotencyKey?: string) {
    try {
      return await this.fetchImpl(this.url(path), {
        ...init,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.credentials.apiKey}`,
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError" ? "délai dépassé" : "réseau";
      throw new FneProviderError("transient", `Service FNE injoignable (${reason}).`);
    }
  }

  /** Traduction du payload neutre vers le format de l'API (gabarit, voir la note de classe). */
  toDgiBody(invoice: FneInvoicePayload): Record<string, unknown> {
    return {
      invoiceType: invoice.documentType === "CREDIT_NOTE" ? "refund" : "sale",
      reference: invoice.number,
      issuedAt: invoice.issuedAt.toISOString(),
      seller: {
        ncc: invoice.seller.ncc,
        name: invoice.seller.legalName,
        taxRegime: invoice.seller.taxRegime,
        establishment: invoice.seller.establishmentId ?? this.credentials.establishmentId ?? null,
        pointOfSale: invoice.seller.pointOfSale ?? this.credentials.pointOfSale ?? null,
      },
      client: {
        name: invoice.customer.name,
        ncc: invoice.customer.ncc,
        phone: invoice.customer.phone,
        type: invoice.customer.type === "COMPANY" ? "B2B" : "B2C",
      },
      items: invoice.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discountRate,
        taxRate: l.vatRate,
        amountHt: l.totalHt,
        amountTax: l.totalVat,
        amountTtc: l.totalTtc,
      })),
      totals: {
        ht: invoice.totals.subtotal,
        discount: invoice.totals.discountTotal,
        tax: invoice.totals.vatTotal,
        ttc: invoice.totals.total,
      },
      paymentMethod: invoice.paymentMethod,
      originalInvoice: invoice.originalInvoice
        ? {
            reference: invoice.originalInvoice.number,
            fneNumber: invoice.originalInvoice.fneNumber,
          }
        : null,
    };
  }

  async certify(invoice: FneInvoicePayload): Promise<FneCertifyResult> {
    const res = await this.request(
      "/invoices/certify",
      { method: "POST", body: JSON.stringify(this.toDgiBody(invoice)) },
      invoice.idempotencyKey,
    );
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const detail =
        (body && typeof body.message === "string" && body.message) || `HTTP ${res.status}`;
      const kind =
        res.status === 429 || res.status >= 500 || res.status === 408 ? "transient" : "rejected";
      throw new FneProviderError(kind, detail.slice(0, 300), { status: res.status });
    }
    const fneNumber = body?.fneNumber ?? body?.number;
    const qrCode = body?.qrCode ?? body?.qr;
    if (typeof fneNumber !== "string" || typeof qrCode !== "string") {
      throw new FneProviderError("transient", "Réponse FNE incomplète (numéro ou QR code absent).");
    }
    const signedAt = typeof body?.signedAt === "string" ? new Date(body.signedAt) : new Date(NaN);
    return {
      fneNumber,
      qrCode,
      signedAt: Number.isNaN(signedAt.getTime()) ? invoice.issuedAt : signedAt,
      raw: body,
    };
  }

  async healthCheck(): Promise<FneHealthStatus> {
    try {
      const res = await this.request("/auth/check", { method: "GET" });
      if (res.ok) return { ok: true, detail: "Identifiants DGI acceptés." };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, detail: "Identifiants DGI refusés : vérifiez la clé d'accès." };
      }
      return { ok: false, detail: `Service FNE en erreur (HTTP ${res.status}).` };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : "Service FNE injoignable.",
      };
    }
  }
}
