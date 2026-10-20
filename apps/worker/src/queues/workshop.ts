// M06 §9 — `workshop.close_stale` (toutes les heures à :59 ; la clôture des entrées ouvertes et
// des présences n'a lieu qu'en fin de journée locale) et `workshop.late_alerts` (15 min).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const WORKSHOP_QUEUE_NAME = "workshop";

export const WORKSHOP_JOB_NAMES = {
  CLOSE_STALE: "workshop.close_stale",
  LATE_ALERTS: "workshop.late_alerts",
} as const;

let queue: Queue | undefined;

export function getWorkshopQueue(): Queue {
  queue ??= new Queue(WORKSHOP_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleWorkshopJobs(): Promise<void> {
  await getWorkshopQueue().upsertJobScheduler(
    WORKSHOP_JOB_NAMES.CLOSE_STALE,
    { pattern: "59 * * * *", tz: "Africa/Abidjan" },
    { name: WORKSHOP_JOB_NAMES.CLOSE_STALE },
  );
  await getWorkshopQueue().upsertJobScheduler(
    WORKSHOP_JOB_NAMES.LATE_ALERTS,
    { pattern: "*/15 6-21 * * *", tz: "Africa/Abidjan" },
    { name: WORKSHOP_JOB_NAMES.LATE_ALERTS },
  );
}
