// M13 §9 (partie 2, étape 6.4) — file `sync` : `imports.watch` (toutes les 15 min) repère
// les sources planifiées dues et enqueue un `sync.run` par source (RG-M13-27). `jobId` fixe
// par source et par échéance : jamais deux synchros simultanées de la même source.
// Doit correspondre à apps/web/src/server/sync/queue.ts (producteur de « Synchroniser maintenant »).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const SYNC_QUEUE_NAME = "sync";

export const SYNC_JOB_NAMES = {
  WATCH: "imports.watch",
  RUN: "sync.run",
  AGENTS_HEALTH: "sync.agents_health",
} as const;

export interface SyncRunJobData {
  organizationId: string;
  dataSourceId: string;
}

/** RG-M13-27 : 3 nouvelles tentatives à 1, 5 et 15 min. */
export const SYNC_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

let queue: Queue | undefined;

export function getSyncQueue(): Queue {
  queue ??= new Queue(SYNC_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function enqueueSyncRun(data: SyncRunJobData, runKey: string): Promise<void> {
  await getSyncQueue().add(SYNC_JOB_NAMES.RUN, data, {
    jobId: `sync-${data.dataSourceId}-${runKey}`,
    attempts: SYNC_RETRY_DELAYS_MS.length + 1,
    backoff: { type: "atelieros-sync" },
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function scheduleSyncJobs(): Promise<void> {
  await getSyncQueue().upsertJobScheduler(
    SYNC_JOB_NAMES.WATCH,
    { pattern: "*/15 * * * *" },
    { name: SYNC_JOB_NAMES.WATCH },
  );
  await getSyncQueue().upsertJobScheduler(
    SYNC_JOB_NAMES.AGENTS_HEALTH,
    { pattern: "*/5 * * * *" },
    { name: SYNC_JOB_NAMES.AGENTS_HEALTH },
  );
}
