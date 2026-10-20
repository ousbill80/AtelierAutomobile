// Producteur de la file BullMQ « exports » (M15 RG-M15-21) : `org.export` ajouté après la
// création d'un `DataExport`. Les noms doivent rester identiques à
// `apps/worker/src/queues/exports.ts`, qui la consomme.
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const EXPORTS_QUEUE_NAME = "exports";
export const ORG_EXPORT_JOB_NAME = "org.export";

let redisConnection: IORedis | undefined;
let exportsQueue: Queue | undefined;

function getExportsQueue(): Queue | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  redisConnection ??= new IORedis(url, { maxRetriesPerRequest: null });
  exportsQueue ??= new Queue(EXPORTS_QUEUE_NAME, { connection: redisConnection });
  return exportsQueue;
}

/** Best effort : sans Redis, l'export reste PENDING et le balayage `exports.sweep` le reprend. */
export async function enqueueOrgExportJob(organizationId: string, exportId: string): Promise<void> {
  try {
    const queue = getExportsQueue();
    if (!queue) return;
    await Promise.race([
      queue.add(
        ORG_EXPORT_JOB_NAME,
        { organizationId, exportId },
        { jobId: `org-export-${exportId}`, removeOnComplete: 100, removeOnFail: 100 },
      ),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch {
    // Redis indisponible : repris par `exports.sweep`.
  }
}
