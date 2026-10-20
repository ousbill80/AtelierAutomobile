// M13 partie 2 (étape 6.4) — API de l'agent local (RG-M13-28) : appairage par code,
// configuration, réception des lots et battement de vie. Les routes de
// `app/api/v1/sync/*` ne font qu'appeler ces gestionnaires. Le jeton de l'agent n'est
// jamais stocké en clair (sha256) ; l'organisation est toujours celle de l'agent.
import { gunzipSync } from "node:zlib";
import {
  effectiveAgentStatus,
  hashAgentToken,
  generateAgentToken,
  isClockSkewed,
  isDomainError,
  normalizePairingCode,
  AGENT_SYNC_BATCH_SIZE,
  SYNC_ENTITY_ORDER,
  type SyncEntity,
} from "@atelieros/core";
import { adminDb, db, type SyncAgent } from "@atelieros/db";
import { importSyncRows, parseSqlSourceConfig } from "@atelieros/import";
import { loadEncryptionKey } from "@atelieros/integrations";
import { z } from "zod";

type ApiErrorCode =
  | "invalid_pairing_code"
  | "invalid_agent_token"
  | "validation_failed"
  | "idempotency_key_required"
  | "internal_error";

/** RG-M13-35 : `{ "error": { "code", "message", "details" } }`. */
function apiError(status: number, code: ApiErrorCode, message: string, details?: unknown) {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** Authentifie l'agent par `Authorization: Bearer sa_live_…` (révoqué → 401 immédiat). */
export async function authenticateAgent(req: Request): Promise<SyncAgent | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("sa_live_")) return null;
  const agent = await adminDb.syncAgent.findUnique({
    where: { tokenHash: await hashAgentToken(token) },
  });
  if (!agent || agent.status === "REVOKED") return null;
  return agent;
}

const pairSchema = z.object({
  code: z.string().min(1).max(32),
  hostname: z.string().max(255).optional(),
  version: z.string().max(64).optional(),
});

/** `POST /api/v1/sync/pair` — échange le code d'appairage (15 min) contre un jeton. */
export async function handlePair(req: Request, now = new Date()): Promise<Response> {
  const parsed = pairSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(400, "validation_failed", "Code d'appairage manquant.");
  }
  const code = normalizePairingCode(parsed.data.code);
  const agent = await adminDb.syncAgent.findUnique({ where: { pairingCode: code } });
  if (
    !agent ||
    agent.status !== "PAIRING" ||
    !agent.pairingExpiresAt ||
    agent.pairingExpiresAt.getTime() < now.getTime()
  ) {
    return apiError(
      401,
      "invalid_pairing_code",
      "Code d'appairage invalide ou expiré : générez-en un nouveau dans AtelierOS (Import → Agent local).",
    );
  }
  const token = generateAgentToken();
  await db.forTenant({ organizationId: agent.organizationId }).syncAgent.update({
    where: { id: agent.id },
    data: {
      tokenHash: await hashAgentToken(token),
      pairingCode: null,
      pairingExpiresAt: null,
      status: "ONLINE",
      lastSeenAt: now,
      hostname: parsed.data.hostname,
      version: parsed.data.version,
    },
  });
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: agent.organizationId },
    select: { name: true },
  });
  return Response.json({ token, agent_id: agent.id, organization_name: org.name });
}

/** `GET /api/v1/sync/config` — requêtes, planning et politique de la source de l'agent. */
export async function handleConfig(req: Request): Promise<Response> {
  const agent = await authenticateAgent(req);
  if (!agent) return apiError(401, "invalid_agent_token", "Jeton d'agent invalide ou révoqué.");
  const source = agent.dataSourceId
    ? await db
        .forTenant({ organizationId: agent.organizationId })
        .dataSource.findFirst({ where: { id: agent.dataSourceId } })
    : null;
  const config = source ? parseSqlSourceConfig(source.config, loadEncryptionKey()) : null;
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: agent.organizationId },
    select: { timezone: true },
  });
  return Response.json({
    agent_id: agent.id,
    active: source?.isActive ?? false,
    schedule: source?.schedule ?? "0 2 * * *",
    timezone: org.timezone,
    policy: config?.policy ?? "UPSERT",
    queries: Object.fromEntries(
      SYNC_ENTITY_ORDER.map((e) => [e, config?.queries[e]?.trim() || null]),
    ),
    watch_rules: config?.watchRules ?? [],
    server_time: new Date().toISOString(),
  });
}

const batchSchema = z.object({
  entity: z.enum(SYNC_ENTITY_ORDER),
  columns: z.array(z.string().min(1).max(128)).min(1).max(200),
  rows: z.array(z.array(z.string().max(10_000))).max(AGENT_SYNC_BATCH_SIZE),
});

async function readJsonBody(req: Request): Promise<unknown> {
  const raw = Buffer.from(await req.arrayBuffer());
  const text =
    req.headers.get("content-encoding") === "gzip"
      ? gunzipSync(raw).toString("utf8")
      : raw.toString("utf8");
  return JSON.parse(text);
}

/**
 * `POST /api/v1/sync/batches` — un lot de ≤ 500 lignes d'une entité, idempotent par
 * `Idempotency-Key` (même clé → même réponse, sans réécriture).
 */
export async function handleBatch(req: Request, now = new Date()): Promise<Response> {
  const agent = await authenticateAgent(req);
  if (!agent) return apiError(401, "invalid_agent_token", "Jeton d'agent invalide ou révoqué.");
  const key = req.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 255) {
    return apiError(400, "idempotency_key_required", "En-tête Idempotency-Key obligatoire.");
  }
  const tenantDb = db.forTenant({ organizationId: agent.organizationId });
  const previous = await tenantDb.syncBatch.findFirst({
    where: { agentId: agent.id, idempotencyKey: key },
  });
  if (previous) return Response.json(previous.response);

  let body: z.infer<typeof batchSchema>;
  try {
    body = batchSchema.parse(await readJsonBody(req));
  } catch {
    return apiError(422, "validation_failed", "Lot invalide (entité, colonnes ou 500 lignes max).");
  }
  if (body.rows.some((r) => r.length !== body.columns.length)) {
    return apiError(
      422,
      "validation_failed",
      "Chaque ligne doit avoir autant de valeurs que de colonnes.",
    );
  }
  if (!agent.dataSourceId) {
    return apiError(422, "validation_failed", "Aucune source n'est rattachée à cet agent.");
  }
  const source = await tenantDb.dataSource.findFirstOrThrow({ where: { id: agent.dataSourceId } });
  const config = parseSqlSourceConfig(source.config, loadEncryptionKey());

  try {
    const result = await importSyncRows({
      organizationId: agent.organizationId,
      dataSourceId: source.id,
      sourceName: source.name,
      entity: body.entity as SyncEntity,
      result: { columns: body.columns, rows: body.rows },
      policy: config.policy ?? "UPSERT",
      now,
    });
    const response = {
      entity: result.entity,
      rows: result.rows,
      created: result.create,
      updated: result.update,
      unchanged: result.unchanged,
      errors: result.error,
      import_job_id: result.jobId,
    };
    await tenantDb.syncBatch.create({
      data: {
        organizationId: agent.organizationId,
        agentId: agent.id,
        idempotencyKey: key,
        entity: body.entity,
        rowCount: body.rows.length,
        importJobId: result.jobId,
        response,
      },
    });
    await tenantDb.dataSource.update({
      where: { id: source.id },
      data: {
        lastRunAt: now,
        lastSuccessAt: now,
        lastStatus: "SUCCESS",
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    await tenantDb.syncAgent.update({
      where: { id: agent.id },
      data: { lastSeenAt: now, status: "ONLINE" },
    });
    return Response.json(response);
  } catch (error) {
    const message = isDomainError(error) ? error.message : "Erreur pendant l'import du lot.";
    await tenantDb.dataSource.update({
      where: { id: source.id },
      data: { lastRunAt: now, lastStatus: "FAILED", lastError: message },
    });
    return apiError(500, "internal_error", message);
  }
}

const heartbeatSchema = z.object({
  version: z.string().max(64).optional(),
  hostname: z.string().max(255).optional(),
  last_error: z.string().max(2000).nullable().optional(),
  agent_time: z.string().datetime().optional(),
});

/** `POST /api/v1/sync/heartbeat` — toutes les 5 min ; signale un décalage d'horloge > 5 min. */
export async function handleHeartbeat(req: Request, now = new Date()): Promise<Response> {
  const agent = await authenticateAgent(req);
  if (!agent) return apiError(401, "invalid_agent_token", "Jeton d'agent invalide ou révoqué.");
  const parsed = heartbeatSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return apiError(422, "validation_failed", "Battement invalide.");
  const skew = parsed.data.agent_time
    ? isClockSkewed(new Date(parsed.data.agent_time), now)
    : false;
  await db.forTenant({ organizationId: agent.organizationId }).syncAgent.update({
    where: { id: agent.id },
    data: {
      status: "ONLINE",
      lastSeenAt: now,
      version: parsed.data.version ?? agent.version,
      hostname: parsed.data.hostname ?? agent.hostname,
      lastError: skew
        ? "Horloge du PC décalée de plus de 5 minutes : corrigez l'heure de Windows."
        : (parsed.data.last_error ?? null),
    },
  });
  return Response.json({
    status: effectiveAgentStatus({ status: "ONLINE", lastSeenAt: now }, now),
    server_time: now.toISOString(),
    clock_skew: skew,
  });
}
