// M13 §4.7 — API REST publique : format des clés (RG-M13-30), scopes (RG-M13-31), pagination par
// curseur (RG-M13-32), idempotence (RG-M13-33), limitation de débit (RG-M13-34), erreurs
// (RG-M13-35). Fonctions pures : le hachage et l'aléa sont fournis par l'appelant (pas de
// `node:crypto` dans core, consommé aussi par le navigateur).
import { DomainError } from "../errors";

export const API_SCOPES = [
  "customers:read",
  "customers:write",
  "vehicles:read",
  "vehicles:write",
  "invoices:read",
  "invoices:write",
  "payments:read",
  "payments:write",
  "products:read",
  "products:write",
  "repair_orders:read",
  "repair_orders:write",
  "appointments:read",
  "appointments:write",
  "quotes:read",
  "reminders:read",
  "reports:read",
  "webhooks:manage",
  "sync:push",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export type ApiEnvironment = "live" | "test";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const API_KEY_SECRET_LENGTH = 32;
const KEY_PATTERN = /^ak_(live|test)_[0-9A-Za-z]{32}$/;

/** RG-M13-30 — `ak_live_<32 car. base62>` à partir d'octets aléatoires fournis (≥ 32). */
export function formatApiKey(environment: ApiEnvironment, randomBytes: Uint8Array): string {
  if (randomBytes.length < API_KEY_SECRET_LENGTH) {
    throw new DomainError("api_key.entropy", "Aléa insuffisant pour générer une clé API.");
  }
  let secret = "";
  for (let i = 0; i < API_KEY_SECRET_LENGTH; i++) secret += BASE62[randomBytes[i]! % 62];
  return `ak_${environment}_${secret}`;
}

/** Préfixe affiché : `ak_live_3f9a…` (jamais la clé complète). */
export function apiKeyPrefix(key: string): string {
  return `${key.slice(0, 12)}…`;
}

/** Lit `Authorization: Bearer ak_…` ; null si absent ou mal formé. */
export function parseBearerApiKey(header: string | null | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((header ?? "").trim());
  const key = match?.[1] ?? null;
  return key && KEY_PATTERN.test(key) ? key : null;
}

export function apiKeyEnvironment(key: string): ApiEnvironment {
  return key.startsWith("ak_test_") ? "test" : "live";
}

/** RG-M13-31 — scopes connus, sans doublon ; `write` n'implique jamais `read`. */
export function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const unknown = scopes.filter((s) => !(API_SCOPES as readonly string[]).includes(s));
  if (unknown.length > 0) {
    throw new DomainError("api_key.unknown_scope", `Scope inconnu : ${unknown.join(", ")}.`, {
      unknown,
    });
  }
  if (scopes.length === 0) {
    throw new DomainError("api_key.no_scope", "Choisissez au moins un droit pour cette clé.");
  }
  return API_SCOPES.filter((s) => scopes.includes(s));
}

export function hasScope(granted: readonly string[], required: ApiScope): boolean {
  return granted.includes(required);
}

export interface ApiKeyState {
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export function isApiKeyUsable(key: ApiKeyState, now: Date): boolean {
  return !key.revokedAt && (!key.expiresAt || key.expiresAt.getTime() > now.getTime());
}

/** RG-M13-30 — `lastUsedAt` mis à jour au plus une fois par minute. */
export function shouldTouchLastUsed(lastUsedAt: Date | null, now: Date): boolean {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= 60_000;
}

// ───────────── Pagination (RG-M13-32) ─────────────

export const API_DEFAULT_LIMIT = 50;
export const API_MAX_LIMIT = 200;

export function clampLimit(raw: string | null | undefined): number {
  if (raw == null || raw === "") return API_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ApiError(
      400,
      "validation_failed",
      "Le paramètre limit doit être un entier positif.",
      [{ field: "limit", issue: "invalid" }],
    );
  }
  return Math.min(n, API_MAX_LIMIT);
}

export interface CursorPosition {
  /** Horodatage de tri (`updatedAt` ou `createdAt`) en ISO 8601. */
  at: string;
  id: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "===".slice((padded.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeCursor(position: CursorPosition): string {
  return toBase64Url(JSON.stringify([position.at, position.id]));
}

export function decodeCursor(cursor: string | null | undefined): CursorPosition | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(fromBase64Url(cursor)) as unknown;
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      typeof value[1] === "string" &&
      !Number.isNaN(Date.parse(value[0]))
    ) {
      return { at: value[0], id: value[1] };
    }
  } catch {
    // curseur illisible
  }
  throw new ApiError(400, "validation_failed", "Curseur de pagination invalide.", [
    { field: "cursor", issue: "invalid" },
  ]);
}

/** `limit + 1` lignes lues → page de `limit` et curseur suivant (ou null). */
export function pageOf<T extends { id: string }>(
  rows: readonly T[],
  limit: number,
  positionOf: (row: T) => Date,
): { data: T[]; next_cursor: string | null } {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return {
    data,
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ at: positionOf(last).toISOString(), id: last.id })
        : null,
  };
}

/** `updated_since` (ISO 8601) ; erreur 400 lisible si invalide. */
export function parseUpdatedSince(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) {
    throw new ApiError(400, "validation_failed", "updated_since doit être une date ISO 8601.", [
      { field: "updated_since", issue: "invalid" },
    ]);
  }
  return new Date(time);
}

// ───────────── Idempotence (RG-M13-33) ─────────────

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

export type IdempotencyDecision =
  | { action: "execute" }
  | { action: "replay"; status: number; body: unknown }
  | { action: "conflict" };

export function validateIdempotencyKey(raw: string | null | undefined): string {
  const key = (raw ?? "").trim();
  if (!key) {
    throw new ApiError(
      400,
      "idempotency_key_required",
      "En-tête Idempotency-Key obligatoire sur un POST.",
    );
  }
  if (key.length > 255) {
    throw new ApiError(400, "validation_failed", "Idempotency-Key : 255 caractères maximum.", [
      { field: "Idempotency-Key", issue: "too_long" },
    ]);
  }
  return key;
}

/** Même clé + même corps → réponse rejouée ; corps différent → 422 ; expirée → nouvelle exécution. */
export function decideIdempotency(
  stored: {
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
    expiresAt: Date;
  } | null,
  requestHash: string,
  now: Date,
): IdempotencyDecision {
  if (!stored || stored.expiresAt.getTime() <= now.getTime()) return { action: "execute" };
  if (stored.requestHash !== requestHash) return { action: "conflict" };
  return { action: "replay", status: stored.responseStatus, body: stored.responseBody };
}

// ───────────── Limitation de débit (RG-M13-34) ─────────────

export const RATE_LIMITS_PER_MINUTE: Record<string, number> = {
  STARTER: 60,
  PRO: 300,
  NETWORK: 1_200,
};

export function rateLimitFor(plan: string | null | undefined): number {
  return RATE_LIMITS_PER_MINUTE[plan ?? ""] ?? RATE_LIMITS_PER_MINUTE.STARTER!;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Secondes avant qu'une place se libère dans la fenêtre glissante d'une minute. */
  resetSeconds: number;
}

/**
 * Fenêtre glissante de 60 s : `hits` = horodatages (ms) des requêtes déjà acceptées dans la
 * fenêtre (la requête courante non comprise).
 */
export function slidingWindowDecision(
  hits: readonly number[],
  limit: number,
  nowMs: number,
): RateLimitDecision {
  const windowStart = nowMs - 60_000;
  const recent = hits.filter((t) => t > windowStart).sort((a, b) => a - b);
  const allowed = recent.length < limit;
  const used = allowed ? recent.length + 1 : recent.length;
  const oldest = recent[0];
  const resetSeconds =
    oldest === undefined ? 60 : Math.max(1, Math.ceil((oldest + 60_000 - nowMs) / 1000));
  return { allowed, limit, remaining: Math.max(0, limit - used), resetSeconds };
}

// ───────────── Erreurs (RG-M13-35) ─────────────

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** IP tronquée /24 (IPv4) ou /48 (IPv6) pour le journal d'accès. */
export function truncateClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::`;
  return null;
}
