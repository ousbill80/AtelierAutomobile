// M13 §4.7 — socle des routes `/api/v1/*` (hors agent local) : clé `Authorization: Bearer ak_…`
// (sha256 en base, RG-M13-30), scope (RG-M13-31), limitation de débit (RG-M13-34), idempotence
// des POST (RG-M13-33), erreurs normalisées (RG-M13-35), journal d'accès. Toute requête est
// bornée à l'organisation de la clé (db.forTenant) ; les gestionnaires ne font qu'orchestrer.
import {
  ApiError,
  decideIdempotency,
  hasScope,
  IDEMPOTENCY_TTL_MS,
  isApiError,
  isApiKeyUsable,
  isDomainError,
  parseBearerApiKey,
  rateLimitFor,
  shouldTouchLastUsed,
  systemClock,
  truncateClientIp,
  validateIdempotencyKey,
  type ApiScope,
  type Clock,
} from "@atelieros/core";
import { adminDb, db, type ApiKey, type Prisma } from "@atelieros/db";
import { requestFingerprint, sha256Hex } from "@atelieros/integrations";
import { ZodError, type z, type ZodTypeAny } from "zod";
import { rateLimitStore } from "./rateLimit";

let clock: Clock = systemClock;

/** Tests : horloge figée de l'API publique. */
export function setPublicApiClock(next: Clock | null): void {
  clock = next ?? systemClock;
}

export function apiNow(): Date {
  return clock.now();
}

export interface ApiContext {
  apiKey: ApiKey;
  organizationId: string;
  tenantDb: ReturnType<typeof db.forTenant>;
  url: URL;
  params: Record<string, string>;
  /** Corps JSON (POST/PATCH/PUT), `null` sinon. */
  body: unknown;
  now: Date;
}

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface ApiRouteOptions {
  /** Scope exigé ; `null` = toute clé valide (ex. `GET /api/v1/me`). */
  scope: ApiScope | null;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { "content-type": "application/json; charset=utf-8" }),
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/** Valide un corps avec Zod ; erreurs → 422 `validation_failed` avec le détail des champs. */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as z.output<S>;
  throw zodToApiError(parsed.error);
}

function zodToApiError(error: ZodError): ApiError {
  return new ApiError(
    422,
    "validation_failed",
    error.issues[0]?.message ?? "Données invalides.",
    error.issues.map((i) => ({ field: i.path.join(".") || "body", issue: i.message })),
  );
}

function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
}

async function authenticate(req: Request, now: Date): Promise<ApiKey> {
  const raw = parseBearerApiKey(req.headers.get("authorization"));
  if (!raw) throw new ApiError(401, "invalid_api_key", "Clé API absente ou mal formée.");
  const key = await adminDb.apiKey.findUnique({ where: { keyHash: sha256Hex(raw) } });
  if (!key || !isApiKeyUsable(key, now)) {
    throw new ApiError(401, "invalid_api_key", "Clé API invalide, révoquée ou expirée.");
  }
  return key;
}

function errorResponse(error: unknown): { status: number; body: unknown } {
  if (isApiError(error)) return { status: error.status, body: error.toBody() };
  if (error instanceof ZodError) {
    const e = zodToApiError(error);
    return { status: e.status, body: e.toBody() };
  }
  if (isDomainError(error)) {
    return {
      status: 422,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error", message: "Erreur interne. Réessayez plus tard." } },
  };
}

/**
 * Exécute un gestionnaire d'API publique. Réponse toujours JSON, en-têtes `X-RateLimit-*`,
 * requête journalisée (`ApiRequestLog`) même en erreur dès que la clé est connue.
 */
export async function runApi(
  req: Request,
  params: Record<string, string>,
  options: ApiRouteOptions,
  handler: (ctx: ApiContext) => Promise<ApiResult>,
): Promise<Response> {
  const now = apiNow();
  const started = Date.now();
  const url = new URL(req.url);
  let apiKey: ApiKey | null = null;
  let rateHeaders: Record<string, string> = {};
  let result: ApiResult;
  try {
    apiKey = await authenticate(req, now);
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: apiKey.organizationId },
      select: { plan: true },
    });
    const decision = await rateLimitStore()
      .hit(apiKey.id, rateLimitFor(org.plan), now.getTime())
      .catch(() => null);
    if (decision) {
      rateHeaders = {
        "x-ratelimit-limit": String(decision.limit),
        "x-ratelimit-remaining": String(decision.remaining),
        "x-ratelimit-reset": String(decision.resetSeconds),
      };
      if (!decision.allowed) {
        rateHeaders["retry-after"] = String(decision.resetSeconds);
        throw new ApiError(
          429,
          "rate_limited",
          "Trop de requêtes : réessayez dans quelques secondes.",
        );
      }
    }
    if (options.scope && !hasScope(apiKey.scopes, options.scope)) {
      throw new ApiError(
        403,
        "insufficient_scope",
        `Droit « ${options.scope} » requis pour cette clé.`,
      );
    }
    const method = req.method.toUpperCase();
    const rawBody = ["POST", "PATCH", "PUT"].includes(method) ? await req.text() : "";
    let body: unknown = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new ApiError(400, "invalid_json", "Corps JSON illisible.");
      }
    }
    const tenantDb = db.forTenant({ organizationId: apiKey.organizationId });
    const ctx: ApiContext = {
      apiKey,
      organizationId: apiKey.organizationId,
      tenantDb,
      url,
      params,
      body,
      now,
    };
    if (method === "POST") {
      const key = validateIdempotencyKey(req.headers.get("idempotency-key"));
      const fingerprint = requestFingerprint(method, url.pathname, rawBody);
      const stored = await tenantDb.idempotencyKey.findFirst({
        where: { apiKeyId: apiKey.id, key },
      });
      const idem = decideIdempotency(stored, fingerprint, now);
      if (idem.action === "conflict") {
        throw new ApiError(
          422,
          "idempotency_key_reused",
          "Cette Idempotency-Key a déjà servi pour une autre requête.",
        );
      }
      if (idem.action === "replay") {
        result = { status: idem.status, body: idem.body };
      } else {
        result = await handler(ctx);
        if (result.status < 500) {
          const data = {
            requestHash: fingerprint,
            responseStatus: result.status,
            responseBody: (result.body ?? {}) as Prisma.InputJsonValue,
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
            createdAt: now,
          };
          if (stored) {
            await tenantDb.idempotencyKey.update({ where: { id: stored.id }, data });
          } else {
            await tenantDb.idempotencyKey
              .create({
                data: { organizationId: apiKey.organizationId, apiKeyId: apiKey.id, key, ...data },
              })
              .catch(() => undefined);
          }
        }
      }
    } else {
      result = await handler(ctx);
    }
  } catch (error) {
    result = errorResponse(error);
  }
  if (apiKey) {
    const key = apiKey;
    const status = result.status;
    // Journal d'accès et `lastUsedAt` (au plus 1 fois/min) : jamais bloquants.
    await Promise.all([
      db
        .forTenant({ organizationId: key.organizationId })
        .apiRequestLog.create({
          data: {
            organizationId: key.organizationId,
            apiKeyId: key.id,
            method: req.method.toUpperCase(),
            path: url.pathname.slice(0, 300),
            status,
            durationMs: Math.max(0, Date.now() - started),
            ip: truncateClientIp(clientIp(req)),
            createdAt: now,
          },
        })
        .catch(() => undefined),
      shouldTouchLastUsed(key.lastUsedAt, now)
        ? adminDb.apiKey
            .update({ where: { id: key.id }, data: { lastUsedAt: now } })
            .catch(() => undefined)
        : Promise.resolve(),
    ]);
  }
  return json(result.status, result.body, rateHeaders);
}

/** Adapte un gestionnaire au format des route handlers Next.js (`params` asynchrones). */
export function apiRoute<P extends Record<string, string> = Record<string, never>>(
  options: ApiRouteOptions,
  handler: (ctx: ApiContext) => Promise<ApiResult>,
) {
  return async (req: Request, context?: { params?: Promise<P> }) =>
    runApi(req, ((await context?.params) ?? {}) as Record<string, string>, options, handler);
}

export function notFound(what = "Ressource"): never {
  throw new ApiError(404, "not_found", `${what} introuvable.`);
}
