export type Channel = "WHATSAPP" | "SMS" | "EMAIL";

export interface OutboundMessage {
  organizationId: string;
  to: string;
  channel: Channel;
  /** Nom du modèle utilisé (M11) ou "raw" pour un message libre. */
  template: string;
  body: string;
  /** Clé d'idempotence fournie par l'appelant (M10/M11) : un même envoi ne part jamais deux fois. */
  idempotencyKey: string;
}

export interface SendResult {
  providerMessageId: string;
  cost?: number;
}

export interface ProviderEvent {
  kind: "status" | "inbound";
  providerMessageId?: string;
  status?: "SENT" | "DELIVERED" | "READ" | "FAILED";
  from?: string;
  body?: string;
  occurredAt: Date;
}

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

/** 01-architecture-technique.md §10 — un adaptateur par canal (WhatsApp, SMS, Email). */
export interface MessagingProvider {
  channel: Channel;
  send(msg: OutboundMessage): Promise<SendResult>;
  parseWebhook(req: Request): Promise<ProviderEvent[]>;
  verifyWebhook(req: Request): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;
}
