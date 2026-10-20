// M13 §4.8 — points de terminaison des webhooks sortants, partagés par l'API REST
// (`/api/v1/webhook-endpoints`) et le back-office (`webhooks.*`) : URL https publique (anti-SSRF),
// événements de la liste RG-M13-38, secret `whsec_…` chiffré (montré une seule fois), rotation
// avec 24 h de double signature, test et relivraison immédiats.
import {
  activeWebhookSecrets,
  isDomainError,
  normalizeWebhookEvents,
  validateWebhookUrl,
  WEBHOOK_ROTATION_OVERLAP_MS,
} from "@atelieros/core";
import {
  deliverWebhook,
  type Prisma,
  type ScopedTenantClient,
  type WebhookDelivery,
  type WebhookDeliveryDeps,
  type WebhookEndpoint,
  type WebhookTransport,
} from "@atelieros/db";
import {
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  loadEncryptionKey,
  resolveWebhookSender,
  signWebhook,
} from "@atelieros/integrations";

type Tx = ScopedTenantClient;

interface StoredSecret {
  current: string;
  previous?: string | null;
  previousUntil?: string | null;
}

let transportOverride: WebhookTransport | null = null;

/** Tests : impose le transport (ex. simulateur qui répond 500) ; `null` rétablit le choix par défaut. */
export function setWebhookTransport(next: WebhookTransport | null): void {
  transportOverride = next;
}

export function webhookDeliveryDeps(): WebhookDeliveryDeps {
  return {
    transport: transportOverride ?? resolveWebhookSender(),
    secretsOf: (encrypted, now) => activeWebhookSecrets(readSecret(encrypted), now),
    sign: signWebhook,
  };
}

function readSecret(encrypted: string): StoredSecret {
  return JSON.parse(decryptSecret(encrypted, loadEncryptionKey())) as StoredSecret;
}

function writeSecret(secret: StoredSecret): string {
  return encryptSecret(JSON.stringify(secret), loadEncryptionKey());
}

export class WebhookInputError extends Error {}

/** Erreurs du core (URL, événements) → message français réutilisable par REST et tRPC. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (isDomainError(error)) throw new WebhookInputError(error.message);
    throw error;
  }
}

export function serializeEndpoint(e: WebhookEndpoint) {
  return {
    id: e.id,
    url: e.url,
    events: e.events,
    description: e.description,
    is_active: e.isActive,
    disabled_at: e.disabledAt?.toISOString() ?? null,
    consecutive_failures: e.consecutiveFailures,
    created_at: e.createdAt.toISOString(),
  };
}

export async function createEndpoint(
  tx: Tx,
  input: {
    organizationId: string;
    url: string;
    events: string[];
    description?: string | null;
    createdById: string | null;
    now: Date;
  },
): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
  const url = guard(() => validateWebhookUrl(input.url)).toString();
  const events = guard(() => normalizeWebhookEvents(input.events));
  const secret = generateWebhookSecret();
  const endpoint = await tx.webhookEndpoint.create({
    data: {
      organizationId: input.organizationId,
      url,
      events,
      description: input.description ?? null,
      secret: writeSecret({ current: secret }),
      createdById: input.createdById,
      createdAt: input.now,
      fanoutCursor: input.now,
    },
  });
  return { endpoint, secret };
}

export async function updateEndpoint(
  tx: Tx,
  endpoint: WebhookEndpoint,
  input: {
    url?: string;
    events?: string[];
    description?: string | null;
    isActive?: boolean;
    rotateSecret?: boolean;
    now: Date;
  },
): Promise<{ endpoint: WebhookEndpoint; secret: string | null }> {
  const data: Prisma.WebhookEndpointUncheckedUpdateInput = {};
  if (input.url !== undefined) data.url = guard(() => validateWebhookUrl(input.url!)).toString();
  if (input.events !== undefined) data.events = guard(() => normalizeWebhookEvents(input.events!));
  if (input.description !== undefined) data.description = input.description;
  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
    if (input.isActive) {
      // Réactivation : compteur remis à zéro, diffusion reprise à partir de maintenant.
      data.disabledAt = null;
      data.consecutiveFailures = 0;
      if (!endpoint.isActive) data.fanoutCursor = input.now;
    }
  }
  let secret: string | null = null;
  if (input.rotateSecret) {
    secret = generateWebhookSecret();
    const previous = readSecret(endpoint.secret).current;
    data.secret = writeSecret({
      current: secret,
      previous,
      previousUntil: new Date(input.now.getTime() + WEBHOOK_ROTATION_OVERLAP_MS).toISOString(),
    });
  }
  const updated = await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data });
  return { endpoint: updated, secret };
}

/** « Tester » : livraison `webhook.test` signée, envoyée tout de suite (sans reprise). */
export async function testEndpoint(
  tx: Tx,
  endpoint: WebhookEndpoint,
  now: Date,
): Promise<WebhookDelivery> {
  const eventId = `evt_test_${now.getTime().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const delivery = await tx.webhookDelivery.create({
    data: {
      organizationId: endpoint.organizationId,
      endpointId: endpoint.id,
      eventId,
      eventType: "webhook.test",
      payload: {
        id: eventId,
        type: "webhook.test",
        created_at: now.toISOString(),
        organization_id: endpoint.organizationId,
        data: { message: "Test de webhook AtelierOS" },
      },
      nextAttemptAt: now,
      createdAt: now,
    },
  });
  return delivery;
}

/** Envoi immédiat d'une livraison (test, relivraison manuelle). */
export async function deliverNow(deliveryId: string, now: Date) {
  return deliverWebhook(deliveryId, webhookDeliveryDeps(), now, { force: true });
}

export function serializeDelivery(d: WebhookDelivery) {
  return {
    id: d.id,
    event_id: d.eventId,
    event_type: d.eventType,
    attempt: d.attempt,
    status: d.status.toLowerCase(),
    response_code: d.responseCode,
    last_error: d.lastError,
    next_attempt_at: d.nextAttemptAt?.toISOString() ?? null,
    delivered_at: d.deliveredAt?.toISOString() ?? null,
    created_at: d.createdAt.toISOString(),
  };
}
