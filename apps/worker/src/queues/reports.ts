// M12 §9 — tâches du tableau de bord (partie 1, étape 2.4) : `digest.owner` (résumé quotidien
// gérant) et `alerts.scan` (alertes système). Les deux tournent toutes les 15 min et
// décident elles-mêmes, organisation par organisation, s'il y a quelque chose à faire
// (heure locale atteinte, dédoublonnage par jour).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const REPORTS_QUEUE_NAME = "reports";

export const REPORTS_JOB_NAMES = {
  DIGEST_OWNER: "digest.owner",
  ALERTS_SCAN: "alerts.scan",
} as const;

let queue: Queue | undefined;

export function getReportsQueue(): Queue {
  queue ??= new Queue(REPORTS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleReportJobs(): Promise<void> {
  const queue = getReportsQueue();
  await queue.upsertJobScheduler(
    REPORTS_JOB_NAMES.DIGEST_OWNER,
    { pattern: "*/15 * * * *" },
    { name: REPORTS_JOB_NAMES.DIGEST_OWNER },
  );
  await queue.upsertJobScheduler(
    REPORTS_JOB_NAMES.ALERTS_SCAN,
    { pattern: "*/15 * * * *" },
    { name: REPORTS_JOB_NAMES.ALERTS_SCAN },
  );
}
