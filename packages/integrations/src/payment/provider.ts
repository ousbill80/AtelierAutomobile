export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";

export interface CreatePaymentLinkInput {
  invoiceId: string;
  amount: number;
  customer: { name: string; phone?: string; email?: string };
  expiresAt: Date;
}

export interface CreatePaymentLinkResult {
  url: string;
  providerRef: string;
}

export interface PaymentEvent {
  providerRef: string;
  status: PaymentStatus;
  occurredAt: Date;
  raw: unknown;
}

/** 01-architecture-technique.md §10 — ex. Wave, CinetPay. */
export interface PaymentProvider {
  createPaymentLink(input: CreatePaymentLinkInput): Promise<CreatePaymentLinkResult>;
  parseWebhook(req: Request): Promise<PaymentEvent>;
  getStatus(providerRef: string): Promise<PaymentStatus>;
}
