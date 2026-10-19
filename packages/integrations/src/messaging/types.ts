// Interface d'adaptateur messagerie (docs/01-architecture-technique.md §10, M11 §4.2 RG-M11-04).
// Chaque fournisseur réel (whatsapp_cloud, wa_link, orange_sms, twilio, http_sms, smtp,
// resend) implémente ce contrat ; `console` (ce module) est l'implémentation de
// développement/tests, sans dépendance à un compte fournisseur réel.
//
// organizationId/idempotencyKey ont été ajoutés lors de la réconciliation avec l'Étape 0.5
// (qui avait anticipé indépendamment un contrat légèrement différent) : M11 en a besoin pour
// messaging.enqueue (RG-M11-01, un même idempotencyKey ne part jamais deux fois par canal).

export type MessageChannel = "WHATSAPP" | "SMS" | "EMAIL";

export interface OutboundMessage {
  /** Absent pour les messages système hors organisation (OTP d'authentification, avant connexion). */
  organizationId?: string;
  to: string;
  channel: MessageChannel;
  body: string;
  templateKey?: string;
  /** Clé d'idempotence de l'appelant (RG-M11-01) : "rem:<groupKey>", "inv:<invoiceId>:issued"… */
  idempotencyKey: string;
}

export interface SendResult {
  providerMessageId: string;
  cost?: number;
}

export type ProviderMessageStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface ProviderEvent {
  kind: "status" | "inbound";
  providerMessageId?: string;
  status?: ProviderMessageStatus;
  from?: string;
  body?: string;
  occurredAt: Date;
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
