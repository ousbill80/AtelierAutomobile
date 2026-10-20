// M13 §4.8 / §9 — webhooks sortants. `fanoutWebhookEvents` (abonné générique `webhooks.fanout`)
// transforme les `DomainEvent` en livraisons, une par (point de terminaison, événement) grâce à
// `@@unique([endpointId, eventId])` ; `deliverWebhook` envoie une tentative signée et planifie la
// suivante (RG-M13-40). L'envoi et le déchiffrement du secret sont injectés (packages/integrations).
//
// Idempotence de la livraison : la tentative est « réservée » par un `updateMany` conditionné
// (statut PENDING, échéance passée) qui repousse `nextAttemptAt` d'un bail ; une seule exécution
// gagne, même si deux workers balaient en même temps.
import {
  nextEndpointFailures,
  planDeliveryOutcome,
  publicEventType,
  truncateResponseBody,
  webhookEnvelope,
  WEBHOOK_TIMEOUT_MS,
  type WebhookEventType,
} from "@atelieros/core";
import type { Prisma } from "@prisma/client";
import { adminDb } from "./client";
import { notifyMembers } from "./stock/context";
import { db } from "./tenant";

const FANOUT_BATCH = 500;
const DELIVERY_LEASE_MS = 5 * 60_000;

/** Forme structurelle de `WebhookSender` (packages/integrations). */
export interface WebhookTransport {
  send(request: {
    url: string;
    body: string;
    headers: Record<string, string>;
    timeoutMs: number;
  }): Promise<{ status: number | null; body: string | null; error: string | null }>;
}

export interface WebhookDeliveryDeps {
  transport: WebhookTransport;
  /** Secret chiffré de l'endpoint → secrets actifs (courant + précédent pendant la rotation). */
  secretsOf: (encrypted: string, now: Date) => string[];
  /** HMAC `t=…,v1=…` du corps avec ces secrets. */
  sign: (secrets: readonly string[], body: string, now: Date) => string;
}

function snakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Données publiques d'un événement : clés en snake_case (RG-M13-35), objets imbriqués compris. */
export function publicEventData(payload: unknown): Record<string, unknown> {
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [snakeKey(k), convert(v)]),
      );
    }
    return value;
  };
  const out = convert(payload);
  return out && typeof out === "object" && !Array.isArray(out)
    ? (out as Record<string, unknown>)
    : {};
}

/**
 * Crée les livraisons des événements survenus depuis le curseur de chaque point de terminaison
 * actif (événements choisis seulement), puis avance le curseur. Rejouable sans doublon.
 */
export async function fanoutWebhookEvents(
  now: Date,
  organizationId?: string,
): Promise<{ endpoints: number; deliveries: number }> {
  const endpoints = await adminDb.webhookEndpoint.findMany({
    where: { isActive: true, disabledAt: null, ...(organizationId ? { organizationId } : {}) },
  });
  let deliveries = 0;
  for (const endpoint of endpoints) {
    const wanted = new Set(endpoint.events);
    const since = endpoint.fanoutCursor ?? endpoint.createdAt;
    const events = await adminDb.domainEvent.findMany({
      where: {
        organizationId: endpoint.organizationId,
        type: { in: [...wanted] },
        occurredAt: { gte: since, lte: now },
      },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: FANOUT_BATCH,
    });
    if (events.length === 0) continue;
    const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
    for (const event of events) {
      const type = publicEventType(event.type);
      if (!type || !wanted.has(type)) continue;
      const eventId = `evt_${event.id}`;
      rows.push({
        organizationId: endpoint.organizationId,
        endpointId: endpoint.id,
        eventId,
        eventType: type,
        payload: webhookEnvelope({
          eventId,
          type: type as WebhookEventType,
          occurredAt: event.occurredAt,
          organizationId: endpoint.organizationId,
          data: publicEventData(event.payload),
        }) as Prisma.InputJsonValue,
        nextAttemptAt: now,
      });
    }
    await db.forTenant({ organizationId: endpoint.organizationId }).transaction(async (tx) => {
      if (rows.length > 0) {
        const created = await tx.webhookDelivery.createMany({ data: rows, skipDuplicates: true });
        deliveries += created.count;
      }
      await tx.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { fanoutCursor: events[events.length - 1]!.occurredAt },
      });
    });
  }
  return { endpoints: endpoints.length, deliveries };
}

/** Livraisons à tenter (premier envoi ou reprise échue). */
export async function dueWebhookDeliveryIds(
  now: Date,
  organizationId?: string,
  limit = 200,
): Promise<string[]> {
  const rows = await adminDb.webhookDelivery.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: now },
      ...(organizationId ? { organizationId } : {}),
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export type DeliverOutcome =
  | { outcome: "skipped" }
  | {
      outcome: "SUCCEEDED" | "PENDING" | "FAILED";
      status: number | null;
      endpointDisabled: boolean;
    };

/**
 * Une tentative de livraison : corps envoyé tel qu'enregistré, signature recalculée à chaque
 * tentative (horodatage frais), résultat consigné, reprise planifiée ou abandon, compteur
 * d'échecs du point de terminaison (désactivation à 50, notification OWNER).
 */
export async function deliverWebhook(
  deliveryId: string,
  deps: WebhookDeliveryDeps,
  now: Date,
  options: { force?: boolean } = {},
): Promise<DeliverOutcome> {
  const head = await adminDb.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: { organizationId: true },
  });
  if (!head) return { outcome: "skipped" };
  const tenantDb = db.forTenant({ organizationId: head.organizationId });
  // Réservation de la tentative (bail de 5 min) : une seule exécution concurrente gagne.
  const claimed = await tenantDb.webhookDelivery.updateMany({
    where: options.force
      ? { id: deliveryId }
      : { id: deliveryId, status: "PENDING", nextAttemptAt: { lte: now } },
    data: { status: "PENDING", nextAttemptAt: new Date(now.getTime() + DELIVERY_LEASE_MS) },
  });
  if (claimed.count === 0) return { outcome: "skipped" };
  const delivery = await tenantDb.webhookDelivery.findFirstOrThrow({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  const endpoint = delivery.endpoint;
  if (!endpoint.isActive || endpoint.disabledAt) {
    await tenantDb.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "FAILED", nextAttemptAt: null, lastError: "Point de terminaison désactivé." },
    });
    return { outcome: "FAILED", status: null, endpointDisabled: true };
  }
  const body = JSON.stringify(delivery.payload);
  const response = await deps.transport.send({
    url: endpoint.url,
    body,
    timeoutMs: WEBHOOK_TIMEOUT_MS,
    headers: {
      "content-type": "application/json",
      "user-agent": "AtelierOS-Webhooks/1.0",
      "x-atelieros-event": delivery.eventType,
      "x-atelieros-delivery": delivery.id,
      "x-atelieros-signature": deps.sign(deps.secretsOf(endpoint.secret, now), body, now),
    },
  });
  const attempt = delivery.attempt + 1;
  const plan = planDeliveryOutcome({ attempt, responseStatus: response.status, now });
  const failures = nextEndpointFailures(endpoint.consecutiveFailures, plan.status === "SUCCEEDED");
  await tenantDb.transaction(async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempt,
        status: plan.status,
        nextAttemptAt: plan.nextAttemptAt,
        responseCode: response.status,
        responseBody: truncateResponseBody(response.body),
        lastError: response.error,
        deliveredAt: plan.status === "SUCCEEDED" ? now : null,
      },
    });
    await tx.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        consecutiveFailures: failures.consecutiveFailures,
        ...(failures.disable ? { isActive: false, disabledAt: now } : {}),
      },
    });
    if (failures.disable) {
      await notifyMembers(
        tx,
        endpoint.organizationId,
        { roles: ["OWNER"] },
        {
          type: "webhook.endpoint_disabled",
          title: "Webhook désactivé après 50 échecs",
          body: `${endpoint.url} ne répond plus : corrigez le serveur destinataire puis réactivez le webhook.`,
          link: "/parametres/api",
          severity: "critical",
          dedupeKey: `webhook.disabled:${endpoint.id}:${now.toISOString().slice(0, 10)}`,
        },
      );
    }
  });
  return { outcome: plan.status, status: response.status, endpointDisabled: failures.disable };
}

/** `webhooks.deliver` : toutes les livraisons échues, une tentative chacune. */
export async function deliverDueWebhooks(
  deps: WebhookDeliveryDeps,
  now: Date,
  organizationId?: string,
): Promise<{ attempted: number; succeeded: number }> {
  const ids = await dueWebhookDeliveryIds(now, organizationId);
  let succeeded = 0;
  for (const id of ids) {
    const result = await deliverWebhook(id, deps, now);
    if (result.outcome === "SUCCEEDED") succeeded += 1;
  }
  return { attempted: ids.length, succeeded };
}

/** `idempotency.purge` (horaire) et journal d'accès conservé 90 jours. */
export async function purgeApiState(now: Date): Promise<{ idempotency: number; logs: number }> {
  const [idem, logs] = await Promise.all([
    adminDb.idempotencyKey.deleteMany({ where: { expiresAt: { lte: now } } }),
    adminDb.apiRequestLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 90 * 24 * 3_600_000) } },
    }),
  ]);
  return { idempotency: idem.count, logs: logs.count };
}
