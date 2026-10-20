// M13 §4.8 — webhooks sortants : événements publics (RG-M13-38), en-tête de signature et
// rotation du secret (RG-M13-39), reprises et désactivation (RG-M13-40), URL https sans
// adresse privée (anti-SSRF). Fonctions pures : le HMAC est calculé par l'appelant.
import { DomainError } from "../errors";

export const WEBHOOK_EVENTS = [
  "customer.created",
  "customer.updated",
  "vehicle.created",
  "vehicle.updated",
  "invoice.issued",
  "invoice.voided",
  "invoice.paid",
  "payment.received",
  "repair_order.status_changed",
  "quote.accepted",
  "quote.declined",
  "appointment.created",
  "appointment.cancelled",
  "reminder.sent",
  "import.completed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/**
 * Événement interne (`DomainEvent.type`) → événement public. Les événements internes sans
 * équivalent public ne sont jamais diffusés.
 */
export function publicEventType(internalType: string): WebhookEventType | null {
  return (WEBHOOK_EVENTS as readonly string[]).includes(internalType)
    ? (internalType as WebhookEventType)
    : null;
}

export function normalizeWebhookEvents(events: readonly string[]): WebhookEventType[] {
  const unknown = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (unknown.length > 0) {
    throw new DomainError("webhook.unknown_event", `Événement inconnu : ${unknown.join(", ")}.`);
  }
  if (events.length === 0) {
    throw new DomainError("webhook.no_event", "Choisissez au moins un événement.");
  }
  return WEBHOOK_EVENTS.filter((e) => events.includes(e));
}

/** RG-M13-38 — corps `{ id: "evt_…", type, created_at, organization_id, data }`. */
export function webhookEnvelope(input: {
  eventId: string;
  type: WebhookEventType;
  occurredAt: Date;
  organizationId: string;
  data: Record<string, unknown>;
}) {
  return {
    id: input.eventId.startsWith("evt_") ? input.eventId : `evt_${input.eventId}`,
    type: input.type,
    created_at: input.occurredAt.toISOString(),
    organization_id: input.organizationId,
    data: input.data,
  };
}

/** Message signé : `t + "." + corps` (RG-M13-39). */
export function webhookSignedPayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

/** `t=…,v1=…[,v1=…]` — une signature par secret actif (double signature pendant la rotation). */
export function webhookSignatureHeader(
  timestampSeconds: number,
  signatures: readonly string[],
): string {
  return [`t=${timestampSeconds}`, ...signatures.map((s) => `v1=${s}`)].join(",");
}

export const WEBHOOK_TOLERANCE_SECONDS = 300;
export const WEBHOOK_ROTATION_OVERLAP_MS = 24 * 3_600_000;

/** Côté destinataire (documenté, et utilisé par les tests) : horodatage ±300 s, une v1 valide. */
export function verifyWebhookSignatureHeader(input: {
  header: string | null | undefined;
  nowSeconds: number;
  expected: (timestampSeconds: number) => string;
}): boolean {
  const parts = (input.header ?? "").split(",").map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith("t="))?.slice(2));
  if (!Number.isInteger(t) || Math.abs(input.nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS)
    return false;
  const expected = input.expected(t);
  return parts.filter((p) => p.startsWith("v1=")).some((p) => p.slice(3) === expected);
}

/** Secrets avec lesquels signer : le courant, et l'ancien pendant 24 h après une rotation. */
export function activeWebhookSecrets(
  secret: { current: string; previous?: string | null; previousUntil?: string | null },
  now: Date,
): string[] {
  const out = [secret.current];
  if (secret.previous && secret.previousUntil && Date.parse(secret.previousUntil) > now.getTime()) {
    out.push(secret.previous);
  }
  return out;
}

// ───────────── Livraison (RG-M13-40) ─────────────

/** Délais des reprises après la 1re tentative : 1 min, 5 min, 30 min, 2 h, 5 h, 10 h, 24 h. */
export const WEBHOOK_RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  5 * 3_600_000,
  10 * 3_600_000,
  24 * 3_600_000,
] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;
export const WEBHOOK_DISABLE_AFTER_FAILURES = 50;
export const WEBHOOK_TIMEOUT_MS = 10_000;

export function isWebhookSuccess(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

export type DeliveryOutcome =
  | { status: "SUCCEEDED"; nextAttemptAt: null }
  | { status: "PENDING"; nextAttemptAt: Date }
  | { status: "FAILED"; nextAttemptAt: null };

/** Après la tentative n° `attempt` (1-based) : réussite, nouvelle tentative planifiée ou abandon. */
export function planDeliveryOutcome(input: {
  attempt: number;
  responseStatus: number | null;
  now: Date;
}): DeliveryOutcome {
  if (isWebhookSuccess(input.responseStatus)) return { status: "SUCCEEDED", nextAttemptAt: null };
  const delay = WEBHOOK_RETRY_DELAYS_MS[input.attempt - 1];
  if (delay === undefined) return { status: "FAILED", nextAttemptAt: null };
  return { status: "PENDING", nextAttemptAt: new Date(input.now.getTime() + delay) };
}

/** 50 échecs consécutifs (toutes livraisons confondues) → point de terminaison désactivé. */
export function nextEndpointFailures(
  current: number,
  succeeded: boolean,
): {
  consecutiveFailures: number;
  disable: boolean;
} {
  if (succeeded) return { consecutiveFailures: 0, disable: false };
  const consecutiveFailures = current + 1;
  return { consecutiveFailures, disable: consecutiveFailures >= WEBHOOK_DISABLE_AFTER_FAILURES };
}

export function truncateResponseBody(body: string | null | undefined, max = 2_048): string | null {
  if (body == null) return null;
  return body.length > max ? body.slice(0, max) : body;
}

// ───────────── Anti-SSRF ─────────────

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** Adresse IP privée, locale, de lien local, réservée ou non routable (IPv4 et IPv6). */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = ipv4Parts(host.startsWith("::ffff:") ? host.slice(7) : host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (host.includes(":")) {
    return (
      host === "::" ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb")
    );
  }
  return false;
}

/** RG-M13-40 — URL `https`, sans identifiants, ni hôte local ou adresse IP privée. */
export function validateWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new DomainError("webhook.invalid_url", "URL de webhook invalide.");
  }
  if (url.protocol !== "https:") {
    throw new DomainError(
      "webhook.https_required",
      "L'URL du webhook doit commencer par https://.",
    );
  }
  if (url.username || url.password) {
    throw new DomainError(
      "webhook.invalid_url",
      "L'URL du webhook ne doit pas contenir d'identifiants.",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateAddress(host)
  ) {
    throw new DomainError(
      "webhook.private_address",
      "Adresse interne refusée : le webhook doit viser un serveur public.",
    );
  }
  return url;
}
