// Étape 7.1 / 01 §8 — limitation de débit sur connexion, OTP et webhooks entrants.
// Production : fenêtre glissante dans Redis, partagée entre instances et conservée au redémarrage.
// Tests et absence de REDIS_URL : mémoire du processus.
import { TRPCError } from "@trpc/server";
import {
  checkSlidingWindowRateLimit,
  DEFAULT_RATE_LIMITS,
  InMemoryRateLimiter,
  type RateLimitCheckResult,
  type RateLimiterOptions,
} from "@atelieros/core";
import IORedis from "ioredis";

const memory = new InMemoryRateLimiter();
let redis: IORedis | undefined;
let redisSeq = 0;

function shouldUseRedis(): boolean {
  return !process.env.VITEST && Boolean(process.env.REDIS_URL);
}

async function redisClient(): Promise<IORedis> {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  return redis;
}

async function consumeRedis(
  key: string,
  nowMs: number,
  options: RateLimiterOptions,
): Promise<RateLimitCheckResult> {
  const client = await redisClient();
  const redisKey = `ratelimit:auth:${key}`;
  const windowStart = nowMs - options.windowMs;
  const execResult = await client
    .multi()
    .zremrangebyscore(redisKey, 0, windowStart)
    .zrange(redisKey, 0, -1, "WITHSCORES")
    .exec();
  const range = execResult?.[1];
  if (!range || range[0]) {
    throw range?.[0] ?? new Error("Redis indisponible");
  }
  const values = (range[1] as string[] | null) ?? [];
  const hits: number[] = [];
  for (let i = 1; i < values.length; i += 2) hits.push(Number(values[i]));
  const result = checkSlidingWindowRateLimit(hits, nowMs, options);
  if (result.allowed) {
    redisSeq = (redisSeq + 1) % 1_000_000;
    await client
      .multi()
      .zadd(redisKey, nowMs, `${nowMs}-${process.pid}-${redisSeq}`)
      .pexpire(redisKey, options.windowMs + 1_000)
      .exec();
  }
  return result;
}

async function consume(
  key: string,
  nowMs: number,
  options: RateLimiterOptions,
): Promise<RateLimitCheckResult> {
  if (shouldUseRedis()) {
    try {
      return await consumeRedis(key, nowMs, options);
    } catch {
      // Redis injoignable : le compteur mémoire évite de refuser toute connexion.
    }
  }
  return memory.consume(key, nowMs, options);
}

export function resetSensitiveRateLimiter(): void {
  memory.reset();
}

export async function assertSensitiveRateLimit(
  key: string,
  options: RateLimiterOptions,
): Promise<void> {
  const result = await consume(key, Date.now(), options);
  if (!result.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Trop de tentatives. Réessayez dans quelques minutes.",
    });
  }
}

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/** 429 HTTP pour les routes webhook (avant signature / parsing). */
export async function webhookRateLimitResponse(req: Request): Promise<Response | null> {
  const result = await consume(
    `webhook:${clientIp(req)}`,
    Date.now(),
    DEFAULT_RATE_LIMITS.inboundWebhook,
  );
  if (result.allowed) return null;
  return new Response("Too Many Requests", {
    status: 429,
    headers: {
      "Retry-After": String(Math.max(1, Math.ceil(result.resetMs / 1000))),
    },
  });
}
