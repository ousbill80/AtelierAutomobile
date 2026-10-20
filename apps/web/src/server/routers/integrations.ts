// M13 §8 — back-office de l'API publique (`/parametres/api`) : clés API (`apiKeys.*`, clé en
// clair montrée une seule fois, sha256 en base) et webhooks sortants (`webhooks.*`, secret montré
// une seule fois, test, livraisons, relivraison, journal d'accès). Permission `integration:manage`.
import { TRPCError } from "@trpc/server";
import {
  API_SCOPES,
  apiKeyPrefix,
  isDomainError,
  normalizeScopes,
  WEBHOOK_EVENTS,
} from "@atelieros/core";
import { db, writeAuditLog, type ScopedTenantClient } from "@atelieros/db";
import { generateApiKey, sha256Hex } from "@atelieros/integrations";
import {
  apiKeyCreateInputSchema,
  integrationIdInputSchema,
  webhookCreateInputSchema,
  webhookDeliveriesInputSchema,
  webhookUpdateInputSchema,
} from "@atelieros/validators";
import { apiNow } from "../publicApi/http";
import {
  createEndpoint,
  deliverNow,
  serializeDelivery,
  serializeEndpoint,
  testEndpoint,
  updateEndpoint,
  WebhookInputError,
} from "../publicApi/webhooks";
import { requirePermission, router } from "../trpc";
import type { Ctx, CtxMembership, CtxUser } from "../context";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & { user: CtxUser; membership: CtxMembership; organizationId: string };

function bad(error: unknown): never {
  if (error instanceof WebhookInputError || isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message });
  }
  throw error;
}

async function audit(
  ctx: OrgCtx,
  action: string,
  entity: string,
  entityId: string,
  after?: unknown,
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    action,
    entity,
    entityId,
    after: after as object | undefined,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

async function loadEndpoint(tx: Tx, id: string) {
  const endpoint = await tx.webhookEndpoint.findFirst({ where: { id } });
  if (!endpoint) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook introuvable." });
  return endpoint;
}

export const apiKeysRouter = router({
  list: requirePermission("integration:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const keys = await tenantDb.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { user: { select: { name: true } } } } },
    });
    const since = new Date(apiNow().getTime() - 24 * 3_600_000);
    const usage = await tenantDb.apiRequestLog.groupBy({
      by: ["apiKeyId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = new Map(usage.map((u) => [u.apiKeyId, u._count._all]));
    return {
      scopes: API_SCOPES,
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: k.scopes,
        environment: k.environment,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
        expired: !!k.expiresAt && k.expiresAt.getTime() <= since.getTime() + 24 * 3_600_000,
        createdAt: k.createdAt,
        createdByName: k.createdBy?.user.name ?? null,
        requests24h: counts.get(k.id) ?? 0,
      })),
    };
  }),

  /** La clé en clair n'est renvoyée qu'ici, une seule fois (RG-M13-30). */
  create: requirePermission("integration:manage")
    .input(apiKeyCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      let scopes;
      try {
        scopes = normalizeScopes(input.scopes);
      } catch (error) {
        bad(error);
      }
      const now = apiNow();
      if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La date d'expiration doit être future.",
        });
      }
      const key = generateApiKey(input.environment);
      const created = await db.forTenant({ organizationId: ctx.organizationId }).apiKey.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          keyHash: sha256Hex(key),
          prefix: apiKeyPrefix(key),
          scopes,
          environment: input.environment,
          expiresAt: input.expiresAt ?? null,
          siteIds: input.siteIds,
          createdById: ctx.membership.id,
          createdAt: now,
        },
      });
      await audit(ctx as OrgCtx, "api_key.created", "ApiKey", created.id, {
        name: created.name,
        prefix: created.prefix,
        scopes,
        environment: created.environment,
      });
      return { id: created.id, key, prefix: created.prefix };
    }),

  revoke: requirePermission("integration:manage")
    .input(integrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const key = await tenantDb.apiKey.findFirst({ where: { id: input.id } });
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "Clé introuvable." });
      if (key.revokedAt) return { ok: true as const };
      await tenantDb.apiKey.update({ where: { id: key.id }, data: { revokedAt: apiNow() } });
      await audit(ctx as OrgCtx, "api_key.revoked", "ApiKey", key.id, { prefix: key.prefix });
      return { ok: true as const };
    }),

  /** Journal d'accès des dernières requêtes (50). */
  logs: requirePermission("integration:manage")
    .input(integrationIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tenantDb.apiRequestLog.findMany({
        where: { apiKeyId: input.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return rows.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        status: r.status,
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      }));
    }),
});

export const webhooksRouter = router({
  list: requirePermission("integration:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const endpoints = await tenantDb.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
    return { events: WEBHOOK_EVENTS, endpoints: endpoints.map(serializeEndpoint) };
  }),

  /** Le secret `whsec_…` n'est renvoyé qu'ici (et à la rotation), une seule fois. */
  create: requirePermission("integration:manage")
    .input(webhookCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const out = await tenantDb
        .transaction((tx) =>
          createEndpoint(tx, {
            organizationId: ctx.organizationId,
            url: input.url,
            events: input.events,
            description: input.description,
            createdById: ctx.membership.id,
            now: apiNow(),
          }),
        )
        .catch(bad);
      await audit(ctx as OrgCtx, "webhook.created", "WebhookEndpoint", out.endpoint.id, {
        url: out.endpoint.url,
        events: out.endpoint.events,
        secret: "[secret modifié]",
      });
      return { endpoint: serializeEndpoint(out.endpoint), secret: out.secret };
    }),

  update: requirePermission("integration:manage")
    .input(webhookUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const out = await tenantDb
        .transaction(async (tx) =>
          updateEndpoint(tx, await loadEndpoint(tx, input.id), { ...input, now: apiNow() }),
        )
        .catch(bad);
      await audit(ctx as OrgCtx, "webhook.updated", "WebhookEndpoint", out.endpoint.id, {
        url: out.endpoint.url,
        events: out.endpoint.events,
        isActive: out.endpoint.isActive,
        ...(out.secret ? { secret: "[secret modifié]" } : {}),
      });
      return { endpoint: serializeEndpoint(out.endpoint), secret: out.secret };
    }),

  delete: requirePermission("integration:manage")
    .input(integrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.transaction(async (tx) => {
        const endpoint = await loadEndpoint(tx, input.id);
        await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
      });
      await audit(ctx as OrgCtx, "webhook.deleted", "WebhookEndpoint", input.id);
      return { ok: true as const };
    }),

  test: requirePermission("integration:manage")
    .input(integrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = apiNow();
      const delivery = await tenantDb.transaction(async (tx) =>
        testEndpoint(tx, await loadEndpoint(tx, input.id), now),
      );
      await deliverNow(delivery.id, now);
      return serializeDelivery(
        await tenantDb.webhookDelivery.findFirstOrThrow({ where: { id: delivery.id } }),
      );
    }),

  deliveries: requirePermission("integration:manage")
    .input(webhookDeliveriesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await loadEndpoint(tenantDb as unknown as Tx, input.id);
      const rows = await tenantDb.webhookDelivery.findMany({
        where: { endpointId: input.id },
        orderBy: { createdAt: "desc" },
        take: input.limit,
      });
      return rows.map(serializeDelivery);
    }),

  /** Relivraison manuelle immédiate (livraison échouée ou à rejouer). */
  redeliver: requirePermission("integration:manage")
    .input(integrationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const delivery = await tenantDb.webhookDelivery.findFirst({ where: { id: input.id } });
      if (!delivery) throw new TRPCError({ code: "NOT_FOUND", message: "Livraison introuvable." });
      await deliverNow(delivery.id, apiNow());
      await audit(ctx as OrgCtx, "webhook.redelivered", "WebhookDelivery", delivery.id);
      return serializeDelivery(
        await tenantDb.webhookDelivery.findFirstOrThrow({ where: { id: delivery.id } }),
      );
    }),
});
