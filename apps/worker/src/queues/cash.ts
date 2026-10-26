// M08 §9 — `cash.check_unclosed` (23:00, heure d'Abidjan) : caisse encore ouverte → notification
// au caissier et au propriétaire (RG-M08-29). M18 : `treasury.sync` toutes les 15 min.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const CASH_QUEUE_NAME = "cash";

export const CASH_JOB_NAMES = {
  CHECK_UNCLOSED: "cash.check_unclosed",
  // M18 §9 : projection du grand livre de trésorerie.
  TREASURY_SYNC: "treasury.sync",
} as const;

let queue: Queue | undefined;

export function getCashQueue(): Queue {
  queue ??= new Queue(CASH_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleCashJobs(): Promise<void> {
  await getCashQueue().upsertJobScheduler(
    CASH_JOB_NAMES.CHECK_UNCLOSED,
    { pattern: "0 23 * * *", tz: "Africa/Abidjan" },
    { name: CASH_JOB_NAMES.CHECK_UNCLOSED },
  );
  await getCashQueue().upsertJobScheduler(
    CASH_JOB_NAMES.TREASURY_SYNC,
    { pattern: "*/15 * * * *", tz: "Africa/Abidjan" },
    { name: CASH_JOB_NAMES.TREASURY_SYNC },
  );
}
