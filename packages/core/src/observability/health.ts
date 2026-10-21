// Étape 7.2 — agrégation des sondes de santé (`/api/health`, battement du worker). Fonctions
// pures : les sondes elles-mêmes (Postgres, Redis, S3) sont fournies par l'appelant.

export type HealthCheckName = "database" | "redis" | "storage";

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  /** Code court, jamais le message brut (qui peut contenir une adresse ou un identifiant). */
  error?: "timeout" | "unavailable";
}

export interface HealthReport {
  status: "ok" | "degraded";
  checks: Partial<Record<HealthCheckName, HealthCheckResult>>;
}

export class HealthCheckTimeoutError extends Error {
  constructor(ms: number) {
    super(`Sonde de santé sans réponse après ${ms} ms.`);
    this.name = "HealthCheckTimeoutError";
  }
}

/** Exécute une sonde avec un délai maximal ; ne lève jamais. */
export async function runHealthCheck(
  probe: () => Promise<unknown>,
  timeoutMs: number,
  now: () => number = () => performance.now(),
): Promise<HealthCheckResult> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new HealthCheckTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(now() - startedAt),
      error: error instanceof HealthCheckTimeoutError ? "timeout" : "unavailable",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Lance toutes les sondes en parallèle ; « ok » seulement si toutes répondent. */
export async function buildHealthReport(
  probes: Partial<Record<HealthCheckName, () => Promise<unknown>>>,
  timeoutMs = 3000,
): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(probes).map(
      async ([name, probe]) => [name, await runHealthCheck(probe!, timeoutMs)] as const,
    ),
  );
  const checks = Object.fromEntries(entries) as HealthReport["checks"];
  const status = entries.every(([, result]) => result.ok) ? "ok" : "degraded";
  return { status, checks };
}
