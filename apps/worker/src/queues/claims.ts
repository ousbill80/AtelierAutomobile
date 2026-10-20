// M16 §9 — `claims.plan_followups` (chaque jour 06:00, Abidjan) et `claims.dispatch_followups`
// (toutes les 15 min, lun–ven 08–17 h) : relances de l'assureur (RG-M16-08).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const CLAIMS_QUEUE_NAME = "claims";

export const CLAIMS_JOB_NAMES = {
  PLAN_FOLLOWUPS: "claims.plan_followups",
  DISPATCH_FOLLOWUPS: "claims.dispatch_followups",
} as const;

let queue: Queue | undefined;

export function getClaimsQueue(): Queue {
  queue ??= new Queue(CLAIMS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleClaimsJobs(): Promise<void> {
  await getClaimsQueue().upsertJobScheduler(
    CLAIMS_JOB_NAMES.PLAN_FOLLOWUPS,
    { pattern: "0 6 * * *", tz: "Africa/Abidjan" },
    { name: CLAIMS_JOB_NAMES.PLAN_FOLLOWUPS },
  );
  await getClaimsQueue().upsertJobScheduler(
    CLAIMS_JOB_NAMES.DISPATCH_FOLLOWUPS,
    { pattern: "*/15 8-16 * * 1-5", tz: "Africa/Abidjan" },
    { name: CLAIMS_JOB_NAMES.DISPATCH_FOLLOWUPS },
  );
}
