// M07 §9 — tâches du stock : `stock.reorder_suggestions` (03:00), `stock.integrity_check`
// (03:30, RG-M07-17) et `purchase.late_alerts` (08:00), heure d'Abidjan (UTC+0).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const STOCK_QUEUE_NAME = "stock";

export const STOCK_JOB_NAMES = {
  REORDER_SUGGESTIONS: "stock.reorder_suggestions",
  INTEGRITY_CHECK: "stock.integrity_check",
  PURCHASE_LATE_ALERTS: "purchase.late_alerts",
} as const;

let queue: Queue | undefined;

export function getStockQueue(): Queue {
  queue ??= new Queue(STOCK_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleStockJobs(): Promise<void> {
  const q = getStockQueue();
  const tz = "Africa/Abidjan";
  await q.upsertJobScheduler(
    STOCK_JOB_NAMES.REORDER_SUGGESTIONS,
    { pattern: "0 3 * * *", tz },
    { name: STOCK_JOB_NAMES.REORDER_SUGGESTIONS },
  );
  await q.upsertJobScheduler(
    STOCK_JOB_NAMES.INTEGRITY_CHECK,
    { pattern: "30 3 * * *", tz },
    { name: STOCK_JOB_NAMES.INTEGRITY_CHECK },
  );
  await q.upsertJobScheduler(
    STOCK_JOB_NAMES.PURCHASE_LATE_ALERTS,
    { pattern: "0 8 * * *", tz },
    { name: STOCK_JOB_NAMES.PURCHASE_LATE_ALERTS },
  );
}
