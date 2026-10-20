// M08 §9 — file « fne » : `fne.certify` (à l'émission, produit par apps/web, jobId = invoice.id)
// et `fne.retry` (toutes les 10 min : reprises avec backoff RG-M08-15 et signalement RG-M08-16).
// Les noms doivent rester identiques à `apps/web/src/server/billing/fneQueue.ts`.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const FNE_QUEUE_NAME = "fne";

export const FNE_JOB_NAMES = {
  CERTIFY: "fne.certify",
  RETRY: "fne.retry",
} as const;

export interface FneCertifyJobData {
  organizationId: string;
  invoiceId: string;
}

let queue: Queue | undefined;

export function getFneQueue(): Queue {
  queue ??= new Queue(FNE_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleFneJobs(): Promise<void> {
  await getFneQueue().upsertJobScheduler(
    FNE_JOB_NAMES.RETRY,
    { every: 10 * 60_000 },
    { name: FNE_JOB_NAMES.RETRY },
  );
}
