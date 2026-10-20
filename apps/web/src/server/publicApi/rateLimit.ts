// RG-M13-34 — limitation de débit par clé, fenêtre glissante d'une minute. Redis (ZSET partagé
// par toutes les instances) quand REDIS_URL est défini, sinon mémoire du processus (local, tests).
import { slidingWindowDecision, type RateLimitDecision } from "@atelieros/core";
import IORedis from "ioredis";

export interface RateLimitStore {
  hit(key: string, limit: number, nowMs: number): Promise<RateLimitDecision>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async hit(key: string, limit: number, nowMs: number): Promise<RateLimitDecision> {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > nowMs - 60_000);
    const decision = slidingWindowDecision(recent, limit, nowMs);
    if (decision.allowed) recent.push(nowMs);
    this.hits.set(key, recent);
    return decision;
  }

  reset(): void {
    this.hits.clear();
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  private seq = 0;

  constructor(private readonly redis: IORedis) {}

  async hit(key: string, limit: number, nowMs: number): Promise<RateLimitDecision> {
    const redisKey = `ratelimit:api:${key}`;
    const [, range] = (await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, nowMs - 60_000)
      .zrange(redisKey, 0, -1, "WITHSCORES")
      .exec()) as [unknown, [Error | null, string[]]];
    const values = range[1] ?? [];
    const hits: number[] = [];
    for (let i = 1; i < values.length; i += 2) hits.push(Number(values[i]));
    const decision = slidingWindowDecision(hits, limit, nowMs);
    if (decision.allowed) {
      this.seq = (this.seq + 1) % 1_000_000;
      await this.redis
        .multi()
        .zadd(redisKey, nowMs, `${nowMs}-${process.pid}-${this.seq}`)
        .pexpire(redisKey, 61_000)
        .exec();
    }
    return decision;
  }
}

let store: RateLimitStore | null = null;

/** Store partagé ; Redis indisponible → repli mémoire (jamais de blocage de l'API). */
export function rateLimitStore(): RateLimitStore {
  if (store) return store;
  const url = process.env.REDIS_URL;
  store = url
    ? new RedisRateLimitStore(
        new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false }),
      )
    : new MemoryRateLimitStore();
  return store;
}

/** Tests : impose un store (mémoire) ; `null` rétablit le choix par défaut. */
export function setRateLimitStore(next: RateLimitStore | null): void {
  store = next;
}
