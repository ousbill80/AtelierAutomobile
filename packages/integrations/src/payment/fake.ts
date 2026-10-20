import { randomBytes } from "node:crypto";
import {
  hmacSha256Hex,
  safeEqualHex,
  unpaidStatus,
  type CreatePaymentLinkInput,
  type CreatePaymentLinkResult,
  type OnlinePaymentMethod,
  type PaymentEvent,
  type PaymentProvider,
  type PaymentStatus,
  type PaymentStatusResult,
} from "./provider";

export const SIMULATOR_SIGNATURE_HEADER = "x-simulator-signature";

export interface SimulatedPayment {
  providerRef: string;
  /** Webhook à appeler et page de retour du client. */
  notifyUrl: string | null;
  returnUrl: string | null;
  amount: number;
  method: OnlinePaymentMethod | null;
  status: PaymentStatus;
  paidAmount: number | null;
  paidAt: Date | null;
  payerPhone: string | null;
  description: string | null;
}

/** État des paiements simulés. En mémoire du processus (comme l'opérateur, « hors » de la base). */
export interface SimulatorLedger {
  save(record: SimulatedPayment): void;
  get(providerRef: string): SimulatedPayment | undefined;
}

export function createInMemorySimulatorLedger(): SimulatorLedger {
  const records = new Map<string, SimulatedPayment>();
  return {
    save(record) {
      records.set(record.providerRef, { ...record });
    },
    get(providerRef) {
      const record = records.get(providerRef);
      return record ? { ...record } : undefined;
    },
  };
}

const LEDGER_KEY = Symbol.for("atelieros.paymentSimulatorLedger");

/** Grand livre partagé par tous les modules du processus (Next.js peut dupliquer les modules). */
export function defaultSimulatorLedger(): SimulatorLedger {
  const g = globalThis as unknown as Record<symbol, SimulatorLedger | undefined>;
  g[LEDGER_KEY] ??= createInMemorySimulatorLedger();
  return g[LEDGER_KEY];
}

export interface SimulatedOutcome {
  status: "PAID" | "FAILED";
  /** Montant payé (défaut : celui du lien) — permet de simuler un écart. */
  amount?: number;
  method?: OnlinePaymentMethod;
  payerPhone?: string;
}

/**
 * Simulateur de paiement mobile money (local, tests, démo) : aucun compte réel. Le lien mène à
 * la page `/p/paiement-simule/[ref]` de l'app ; le « paiement » met à jour le grand livre puis
 * produit un webhook signé HMAC-SHA256 comme le ferait un agrégateur. Interdit en production.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";

  constructor(
    private readonly options: {
      appUrl: string;
      webhookSecret: string;
      ledger?: SimulatorLedger;
    },
  ) {}

  private get ledger(): SimulatorLedger {
    return this.options.ledger ?? defaultSimulatorLedger();
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult> {
    const providerRef = `sim_${randomBytes(9).toString("base64url")}`;
    this.ledger.save({
      providerRef,
      notifyUrl: input.notifyUrl ?? null,
      returnUrl: input.returnUrl ?? null,
      amount: input.amount,
      method: input.method ?? null,
      status: "PENDING",
      paidAmount: null,
      paidAt: null,
      payerPhone: null,
      description: input.description ?? input.reference ?? null,
    });
    return { url: `${this.options.appUrl}/p/paiement-simule/${providerRef}`, providerRef };
  }

  sign(rawBody: string): string {
    return hmacSha256Hex(this.options.webhookSecret, rawBody);
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    return safeEqualHex(this.sign(rawBody), headers.get(SIMULATOR_SIGNATURE_HEADER));
  }

  parseWebhook(rawBody: string): PaymentEvent {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    const status = body.status === "PAID" || body.status === "FAILED" ? body.status : "PENDING";
    return {
      providerRef: String(body.providerRef ?? ""),
      status,
      amount: typeof body.amount === "number" ? body.amount : null,
      method: (body.method as OnlinePaymentMethod | null) ?? null,
      paidAt: typeof body.paidAt === "string" ? new Date(body.paidAt) : null,
      payerPhone: typeof body.payerPhone === "string" ? body.payerPhone : null,
      raw: body,
    };
  }

  async getStatus(providerRef: string): Promise<PaymentStatusResult> {
    const record = this.ledger.get(providerRef);
    if (!record) return unpaidStatus("PENDING");
    return {
      status: record.status,
      amount: record.paidAmount,
      method: record.method,
      paidAt: record.paidAt,
      payerPhone: record.payerPhone,
    };
  }

  /** Lien simulé (page de paiement) ; null si inconnu ou déjà traité par ce processus. */
  describe(providerRef: string): SimulatedPayment | undefined {
    return this.ledger.get(providerRef);
  }

  /**
   * « Le client paie » : met à jour le grand livre et renvoie le webhook signé à poster.
   * Un lien déjà payé ou en échec n'est pas rejoué.
   */
  simulate(
    providerRef: string,
    outcome: SimulatedOutcome,
    now: Date,
  ): { rawBody: string; headers: Record<string, string>; notifyUrl: string | null } | null {
    const record = this.ledger.get(providerRef);
    if (!record || record.status !== "PENDING") return null;
    const paid = outcome.status === "PAID";
    const next: SimulatedPayment = {
      ...record,
      status: outcome.status,
      method: outcome.method ?? record.method ?? "WAVE",
      paidAmount: paid ? (outcome.amount ?? record.amount) : null,
      paidAt: paid ? now : null,
      payerPhone: paid ? (outcome.payerPhone ?? null) : null,
    };
    this.ledger.save(next);
    const rawBody = JSON.stringify({
      providerRef,
      status: next.status,
      amount: next.paidAmount,
      method: next.method,
      paidAt: next.paidAt?.toISOString() ?? null,
      payerPhone: next.payerPhone,
    });
    return {
      rawBody,
      headers: {
        "content-type": "application/json",
        [SIMULATOR_SIGNATURE_HEADER]: this.sign(rawBody),
      },
      notifyUrl: record.notifyUrl,
    };
  }
}
