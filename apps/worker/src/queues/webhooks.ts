// M13 §9 — file « webhooks » : `webhooks.fanout` + livraisons échues (chaque minute,
// RG-M13-38/40) et `idempotency.purge` (horaire : clés d'idempotence expirées, journal d'accès
// de plus de 90 j).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const WEBHOOKS_QUEUE_NAME = "webhooks";

export const WEBHOOKS_JOB_NAMES = {
  DISPATCH: "webhooks.dispatch",
  PURGE: "idempotency.purge",
} as const;

let queue: Queue | undefined;

export function getWebhooksQueue(): Queue {
  queue ??= new Queue(WEBHOOKS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleWebhookJobs(): Promise<void> {
  await getWebhooksQueue().upsertJobScheduler(
    WEBHOOKS_JOB_NAMES.DISPATCH,
    { pattern: "* * * * *" },
    { name: WEBHOOKS_JOB_NAMES.DISPATCH },
  );
  await getWebhooksQueue().upsertJobScheduler(
    WEBHOOKS_JOB_NAMES.PURGE,
    { pattern: "17 * * * *" },
    { name: WEBHOOKS_JOB_NAMES.PURGE },
  );
}
