// 01-architecture-technique.md §8 & Étape 7.1 — limitation de débit (rate limiting) par fenêtre glissante et compteurs

export interface RateLimiterOptions {
  /** Nombre maximum de requêtes autorisées dans la fenêtre */
  maxRequests: number;
  /** Durée de la fenêtre en millisecondes */
  windowMs: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

/**
 * Calcule l'autorisation pour une clé donnée selon une liste d'horodatages passés (fenêtre glissante).
 */
export function checkSlidingWindowRateLimit(
  timestamps: readonly number[],
  nowMs: number,
  options: RateLimiterOptions,
): RateLimitCheckResult {
  const windowStart = nowMs - options.windowMs;
  const recentHits = timestamps.filter((t) => t > windowStart).sort((a, b) => a - b);
  const count = recentHits.length;
  const allowed = count < options.maxRequests;
  const remaining = Math.max(0, options.maxRequests - (allowed ? count + 1 : count));

  const oldest = recentHits[0];
  const resetMs = oldest ? Math.max(0, oldest + options.windowMs - nowMs) : options.windowMs;

  return {
    allowed,
    limit: options.maxRequests,
    remaining,
    resetMs,
  };
}

/**
 * Compteur en mémoire (processus) pour login / OTP / webhooks.
 * En production multi-instance, préférer Redis ; ce store suffit au local et aux tests.
 */
export class InMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  consume(key: string, nowMs: number, options: RateLimiterOptions): RateLimitCheckResult {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > nowMs - options.windowMs);
    const result = checkSlidingWindowRateLimit(recent, nowMs, options);
    if (result.allowed) recent.push(nowMs);
    this.hits.set(key, recent);
    return result;
  }

  reset(): void {
    this.hits.clear();
  }
}

/**
 * Configuration par défaut pour les points sensibles d'AtelierOS
 */
export const DEFAULT_RATE_LIMITS = {
  /** Connexion : 10 tentatives par 15 min par IP */
  loginByIp: { maxRequests: 10, windowMs: 15 * 60_000 },
  /** Demande d'OTP : 5 demandes par heure par compte */
  otpByIdentifier: { maxRequests: 5, windowMs: 60 * 60_000 },
  /** Webhook entrant : 120 requêtes par min par IP/expéditeur */
  inboundWebhook: { maxRequests: 120, windowMs: 60_000 },
  /** Export de données : 2 par jour par organisation */
  dataExport: { maxRequests: 2, windowMs: 24 * 60 * 60_000 },
} as const;
