// RG-M13-37 — `/api/v1/webhook-endpoints` (scope webhooks:manage) : liste, création (secret
// renvoyé une seule fois), modification, suppression, test.
import { ApiError } from "@atelieros/core";
import { writeAuditLog, type ScopedTenantClient } from "@atelieros/db";
import {
  apiWebhookEndpointCreateSchema,
  apiWebhookEndpointPatchSchema,
} from "@atelieros/validators";
import { notFound, parseBody, type ApiContext, type ApiResult } from "./http";
import {
  createEndpoint,
  deliverNow,
  serializeDelivery,
  serializeEndpoint,
  testEndpoint,
  updateEndpoint,
  WebhookInputError,
} from "./webhooks";

type Tx = ScopedTenantClient;

async function rethrow<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WebhookInputError) {
      throw new ApiError(422, "validation_failed", error.message);
    }
    throw error;
  }
}

async function loadEndpoint(tx: Tx, id: string) {
  const endpoint = await tx.webhookEndpoint.findFirst({ where: { id } });
  if (!endpoint) notFound("Webhook");
  return endpoint;
}

function audit(ctx: ApiContext, action: string, id: string, after?: unknown) {
  return writeAuditLog({
    organizationId: ctx.organizationId,
    action,
    entity: "WebhookEndpoint",
    entityId: id,
    after: after as object | undefined,
    reason: `api_key:${ctx.apiKey.prefix}`,
  });
}

export async function listEndpoints(ctx: ApiContext): Promise<ApiResult> {
  const rows = await ctx.tenantDb.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
  return { status: 200, body: { data: rows.map(serializeEndpoint), next_cursor: null } };
}

export async function createEndpointRoute(ctx: ApiContext): Promise<ApiResult> {
  const input = parseBody(apiWebhookEndpointCreateSchema, ctx.body);
  const { endpoint, secret } = await rethrow(() =>
    ctx.tenantDb.transaction((tx) =>
      createEndpoint(tx, {
        organizationId: ctx.organizationId,
        url: input.url,
        events: input.events,
        description: input.description,
        createdById: null,
        now: ctx.now,
      }),
    ),
  );
  await audit(ctx, "webhook.created", endpoint.id, {
    url: endpoint.url,
    events: endpoint.events,
    secret: "[secret modifié]",
  });
  return { status: 201, body: { ...serializeEndpoint(endpoint), secret } };
}

export async function patchEndpointRoute(ctx: ApiContext): Promise<ApiResult> {
  const input = parseBody(apiWebhookEndpointPatchSchema, ctx.body);
  const { endpoint } = await rethrow(() =>
    ctx.tenantDb.transaction(async (tx) =>
      updateEndpoint(tx, await loadEndpoint(tx, ctx.params.id!), {
        url: input.url,
        events: input.events,
        description: input.description,
        isActive: input.is_active,
        now: ctx.now,
      }),
    ),
  );
  await audit(ctx, "webhook.updated", endpoint.id, {
    url: endpoint.url,
    events: endpoint.events,
    isActive: endpoint.isActive,
  });
  return { status: 200, body: serializeEndpoint(endpoint) };
}

export async function deleteEndpointRoute(ctx: ApiContext): Promise<ApiResult> {
  await ctx.tenantDb.transaction(async (tx) => {
    const endpoint = await loadEndpoint(tx, ctx.params.id!);
    await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
  });
  await audit(ctx, "webhook.deleted", ctx.params.id!);
  return { status: 204, body: null };
}

export async function testEndpointRoute(ctx: ApiContext): Promise<ApiResult> {
  const delivery = await ctx.tenantDb.transaction(async (tx) =>
    testEndpoint(tx, await loadEndpoint(tx, ctx.params.id!), ctx.now),
  );
  await deliverNow(delivery.id, ctx.now);
  const after = await ctx.tenantDb.webhookDelivery.findFirstOrThrow({ where: { id: delivery.id } });
  return { status: 200, body: serializeDelivery(after) };
}
