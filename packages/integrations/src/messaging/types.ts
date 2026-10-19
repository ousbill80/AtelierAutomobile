// Interface d'adaptateur messagerie (docs/01-architecture-technique.md §10).
// Chaque fournisseur réel (whatsapp-cloud, wa-link, orange-sms, twilio-sms, smtp,
// resend) implémente ce contrat ; `console` (ce module) est l'implémentation de
// développement/tests, sans dépendance à un compte fournisseur réel.

export type MessageChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface OutboundMessage {
  to: string;
  channel: MessageChannel;
  body: string;
  templateKey?: string;
}

export interface SendResult {
  providerMessageId: string;
  cost?: number;
}

export interface ProviderEvent {
  type: "status" | "inbound";
  providerMessageId?: string;
  status?: "sent" | "delivered" | "read" | "failed";
  from?: string;
  body?: string;
  receivedAt: Date;
}

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

export interface MessagingProvider {
  channel: MessageChannel;
  send(msg: OutboundMessage): Promise<SendResult>;
  parseWebhook(req: Request): Promise<ProviderEvent[]>;
  verifyWebhook(req: Request): Promise<boolean>;
  healthCheck(): Promise<HealthStatus>;
}

/** RG-M11-07 : classement des erreurs fournisseur pour décider repli/retry. */
export type ProviderErrorCategory =
  "TEMPORARY" | "PERMANENT_RECIPIENT" | "PERMANENT_TEMPLATE" | "PERMANENT_CONFIG" | "RATE_LIMIT";

/**
 * Forme attendue d'une erreur levée par `MessagingProvider.send` : chaque adaptateur attache
 * `category` (et `providerCode` quand disponible) à l'`Error` qu'il lève, classée par sa propre
 * table `providerErrorMap` (RG-M11-07). `messages.send` (apps/worker) lit ces propriétés par
 * duck-typing plutôt que par une classe commune, pour ne pas imposer de hiérarchie d'erreurs
 * aux adaptateurs.
 */
export interface MessagingSendErrorLike {
  category?: ProviderErrorCategory;
  providerCode?: string;
}
