// M14 §9 — tâche planifiée du portail : `portal.tokens_expire`, quotidienne à 03:30 (heure
// d'Abidjan = UTC) : jetons échus → EXPIRED, purge du journal PortalAccess de plus de 12 mois.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const PORTAL_QUEUE_NAME = "portal";

export const PORTAL_JOB_NAMES = {
  TOKENS_EXPIRE: "portal.tokens_expire",
} as const;

let queue: Queue | undefined;

export function getPortalQueue(): Queue {
  queue ??= new Queue(PORTAL_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function schedulePortalJobs(): Promise<void> {
  await getPortalQueue().upsertJobScheduler(
    PORTAL_JOB_NAMES.TOKENS_EXPIRE,
    { pattern: "30 3 * * *", tz: "Africa/Abidjan" },
    { name: PORTAL_JOB_NAMES.TOKENS_EXPIRE },
  );
}
