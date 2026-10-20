// M15 RG-M15-21/22 — file « exports » : `org.export` (produit par apps/web, jobId = export),
// `exports.sweep` (toutes les 5 min : reprise des exports PENDING, expiration des liens 48 h)
// et `org.purge` (quotidienne : organisations dont la suppression programmée est échue).
// Les noms doivent rester identiques à `apps/web/src/server/plan/exportQueue.ts`.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const EXPORTS_QUEUE_NAME = "exports";

export const EXPORTS_JOB_NAMES = {
  ORG_EXPORT: "org.export",
  SWEEP: "exports.sweep",
  ORG_PURGE: "org.purge",
} as const;

let queue: Queue | undefined;

export function getExportsQueue(): Queue {
  queue ??= new Queue(EXPORTS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleExportJobs(): Promise<void> {
  await getExportsQueue().upsertJobScheduler(
    EXPORTS_JOB_NAMES.SWEEP,
    { every: 5 * 60_000 },
    { name: EXPORTS_JOB_NAMES.SWEEP },
  );
  // 02:30 UTC (= heure d'Abidjan) : hors heures d'ouverture des garages.
  await getExportsQueue().upsertJobScheduler(
    EXPORTS_JOB_NAMES.ORG_PURGE,
    { pattern: "30 2 * * *" },
    { name: EXPORTS_JOB_NAMES.ORG_PURGE },
  );
}
