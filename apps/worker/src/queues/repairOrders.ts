// M04 §9 — tâches planifiées des ordres de réparation : `repairOrders.late_check` (toutes les
// 15 min, OR en retard sur la promesse) et `repairOrders.ready_followup` (quotidien 10:00,
// véhicules prêts non récupérés et frais de gardiennage à proposer).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const REPAIR_ORDERS_QUEUE_NAME = "repairOrders";

export const REPAIR_ORDERS_JOB_NAMES = {
  LATE_CHECK: "repairOrders.late_check",
  READY_FOLLOWUP: "repairOrders.ready_followup",
} as const;

let queue: Queue | undefined;

export function getRepairOrdersQueue(): Queue {
  queue ??= new Queue(REPAIR_ORDERS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleRepairOrderJobs(): Promise<void> {
  const queue = getRepairOrdersQueue();
  await queue.upsertJobScheduler(
    REPAIR_ORDERS_JOB_NAMES.LATE_CHECK,
    { pattern: "*/15 * * * *" },
    { name: REPAIR_ORDERS_JOB_NAMES.LATE_CHECK },
  );
  // Africa/Abidjan = UTC : 10:00 locale (les autres fuseaux sont traités au même instant).
  await queue.upsertJobScheduler(
    REPAIR_ORDERS_JOB_NAMES.READY_FOLLOWUP,
    { pattern: "0 10 * * *" },
    { name: REPAIR_ORDERS_JOB_NAMES.READY_FOLLOWUP },
  );
}
