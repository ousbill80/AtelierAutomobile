// Étape 7.1 / 01 §8 — limitation de débit sur connexion, OTP et webhooks entrants.
import { TRPCError } from "@trpc/server";
import { DEFAULT_RATE_LIMITS, InMemoryRateLimiter, type RateLimiterOptions } from "@atelieros/core";

const limiter = new InMemoryRateLimiter();

export function resetSensitiveRateLimiter(): void {
  limiter.reset();
}

export function assertSensitiveRateLimit(key: string, options: RateLimiterOptions): void {
  const result = limiter.consume(key, Date.now(), options);
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
export function webhookRateLimitResponse(req: Request): Response | null {
  const result = limiter.consume(
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
