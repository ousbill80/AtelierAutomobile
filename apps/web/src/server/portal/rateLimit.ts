// M14 RG-M14-06 — limitation de débit du portail, partagée entre les instances web via Redis
// (compteurs à fenêtre fixe, INCR + PEXPIRE), avec repli en mémoire du processus si Redis est
// absent ou injoignable (et toujours en mémoire sous Vitest : aucun test ne dépend du réseau).
// Remplace les limiteurs en mémoire propres à chaque routeur (RDV, devis, facture).
import IORedis from "ioredis";
import {
  decideRequest,
  PORTAL_RATE_LIMITS,
  shouldBlockAfterInvalid,
  windowKey,
  windowTtlMs,
} from "@atelieros/core";

export interface CounterStore {
  /** Incrémente le compteur et renvoie sa nouvelle valeur (expiration posée au premier hit). */
  incr(key: string, ttlMs: number): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

export function createMemoryStore(): CounterStore & { clear(): void } {
  const values = new Map<string, { value: string; expiresAt: number }>();
  const alive = (key: string) => {
    const entry = values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      values.delete(key);
      return null;
    }
    return entry;
  };
  return {
    async incr(key, ttlMs) {
      const entry = alive(key);
      const next = (entry ? Number(entry.value) : 0) + 1;
      values.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? Date.now() + ttlMs });
      if (values.size > 50_000) {
        for (const k of values.keys()) alive(k);
      }
      return next;
    },
    async get(key) {
      return alive(key)?.value ?? null;
    },
    async set(key, value, ttlMs) {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      values.clear();
    },
  };
}

function createRedisStore(url: string): CounterStore {
  const redis = new IORedis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });
  redis.on("error", () => {
    // Redis injoignable : les appels échouent et l'appelant bascule sur la mémoire.
  });
  return {
    async incr(key, ttlMs) {
      const [[, count]] = (await redis.multi().incr(key).pexpire(key, ttlMs, "NX").exec()) as [
        [unknown, number],
        [unknown, number],
      ];
      return count;
    },
    async get(key) {
      return redis.get(key);
    },
    async set(key, value, ttlMs) {
      await redis.set(key, value, "PX", ttlMs);
    },
  };
}

const memory = createMemoryStore();
let redisStore: CounterStore | null | undefined;

function primaryStore(): CounterStore {
  if (redisStore === undefined) {
    const url = process.env.REDIS_URL;
    redisStore = url && !process.env.VITEST ? createRedisStore(url) : null;
  }
  return redisStore ?? memory;
}

/** Redis d'abord, mémoire si Redis échoue (la protection ne doit jamais bloquer la page). */
const store: CounterStore = {
  async incr(key, ttlMs) {
    try {
      return await primaryStore().incr(key, ttlMs);
    } catch {
      return memory.incr(key, ttlMs);
    }
  },
  async get(key) {
    try {
      return await primaryStore().get(key);
    } catch {
      return memory.get(key);
    }
  },
  async set(key, value, ttlMs) {
    try {
      await primaryStore().set(key, value, ttlMs);
    } catch {
      await memory.set(key, value, ttlMs);
    }
  },
};

/** Quota par minute (surcharge possible pour les E2E, qui partagent une seule IP en parallèle). */
function requestsPerMinute(): number {
  const override = Number(process.env.PORTAL_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(override) && override > 0
    ? override
    : PORTAL_RATE_LIMITS.requestsPerMinute;
}

export type PortalRateResult =
  { allowed: true } | { allowed: false; reason: "BLOCKED" | "TOO_MANY" };

/** Compte une requête du portail pour cette IP et décide (blocage en cours, quota par minute). */
export async function checkPortalRequest(ip: string, now: Date): Promise<PortalRateResult> {
  const subject = ip || "unknown";
  const blocked = (await store.get(`portal:block:${subject}`)) !== null;
  if (blocked) return { allowed: false, reason: "BLOCKED" };
  const count = await store.incr(
    windowKey("portal:req", subject, now, PORTAL_RATE_LIMITS.requestWindowMs),
    windowTtlMs(now, PORTAL_RATE_LIMITS.requestWindowMs),
  );
  // Quota relatif : on ramène le compteur sur l'échelle du PRD quand une surcharge est posée.
  const scaled = Math.ceil((count * PORTAL_RATE_LIMITS.requestsPerMinute) / requestsPerMinute());
  return decideRequest({ blocked: false, countInWindow: scaled });
}

/** Un jeton inconnu de plus pour cette IP : au 5e en 10 min, l'IP est bloquée 30 min. */
export async function recordInvalidPortalToken(ip: string, now: Date): Promise<boolean> {
  const subject = ip || "unknown";
  const count = await store.incr(
    windowKey("portal:invalid", subject, now, PORTAL_RATE_LIMITS.invalidWindowMs),
    windowTtlMs(now, PORTAL_RATE_LIMITS.invalidWindowMs),
  );
  // Seuil relatif, comme le quota par minute (surcharge E2E : une seule IP pour tous les specs).
  const scaled = Math.ceil((count * PORTAL_RATE_LIMITS.requestsPerMinute) / requestsPerMinute());
  if (shouldBlockAfterInvalid(scaled)) {
    await store.set(`portal:block:${subject}`, "1", PORTAL_RATE_LIMITS.blockMs);
    return true;
  }
  return false;
}

/** Compteur générique (OTP par numéro, renvois de lien) : renvoie la valeur après incrément. */
export async function hitCounter(key: string, ttlMs: number): Promise<number> {
  return store.incr(key, ttlMs);
}

/** Tests : remet à zéro la mémoire (Redis n'est jamais utilisé sous Vitest). */
export function resetPortalRateLimits(): void {
  memory.clear();
}
