// M08 §9 — file « payments » : `payments.reconcile` (toutes les 30 min, rattrape les webhooks
// perdus, RG-M08-25) et `paymentLinks.expire` (horaire : liens expirés depuis plus de 24 h).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const PAYMENTS_QUEUE_NAME = "payments";

export const PAYMENTS_JOB_NAMES = {
  RECONCILE: "payments.reconcile",
  EXPIRE_LINKS: "paymentLinks.expire",
} as const;

let queue: Queue | undefined;

export function getPaymentsQueue(): Queue {
  queue ??= new Queue(PAYMENTS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function schedulePaymentJobs(): Promise<void> {
  await getPaymentsQueue().upsertJobScheduler(
    PAYMENTS_JOB_NAMES.RECONCILE,
    { pattern: "*/30 * * * *" },
    { name: PAYMENTS_JOB_NAMES.RECONCILE },
  );
  await getPaymentsQueue().upsertJobScheduler(
    PAYMENTS_JOB_NAMES.EXPIRE_LINKS,
    { pattern: "5 * * * *" },
    { name: PAYMENTS_JOB_NAMES.EXPIRE_LINKS },
  );
}
