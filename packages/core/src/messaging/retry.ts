// RG-M11-07 : 5 tentatives, backoff exponentiel 30 s, 2 min, 8 min, 30 min, 2 h (+ gigue 20 %)

export const TEMPORARY_ERROR_BACKOFF_MS = [30_000, 120_000, 480_000, 1_800_000, 7_200_000] as const;
export const MAX_RETRY_ATTEMPTS = TEMPORARY_ERROR_BACKOFF_MS.length;

/** `attemptsMade` = nombre de tentatives déjà effectuées (1 après le 1er échec). */
export function retryBackoffMs(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade - 1, 0), TEMPORARY_ERROR_BACKOFF_MS.length - 1);
  return TEMPORARY_ERROR_BACKOFF_MS[index]!;
}

/** `jitterRatio` ∈ [-1, 1] (ex. `Math.random() * 2 - 1`) ; ± 20 % appliqué autour du délai de base. */
export function applyJitter(ms: number, jitterRatio: number): number {
  return Math.max(0, Math.round(ms * (1 + jitterRatio * 0.2)));
}
