// M17 §9 — file « ai » : anomalies (06:00), expiration des suggestions (horaire), purge des
// sorties > 180 j et des fils d'assistant expirés (quotidiennes). Jobs répétables à `jobId` fixe.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const AI_QUEUE_NAME = "ai";

export const AI_JOB_NAMES = {
  ANOMALIES: "ai.anomalies",
  SUGGESTIONS_EXPIRE: "ai.suggestions_expire",
  PURGE_OUTPUTS: "ai.purge_outputs",
  ASSISTANT_PURGE: "ai.assistant_purge",
} as const;

let queue: Queue | undefined;

export function getAiQueue(): Queue {
  queue ??= new Queue(AI_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleAiJobs(): Promise<void> {
  const q = getAiQueue();
  await q.upsertJobScheduler(
    AI_JOB_NAMES.ANOMALIES,
    { pattern: "0 6 * * *", tz: "Africa/Abidjan" },
    { name: AI_JOB_NAMES.ANOMALIES },
  );
  await q.upsertJobScheduler(
    AI_JOB_NAMES.SUGGESTIONS_EXPIRE,
    { pattern: "5 * * * *" },
    { name: AI_JOB_NAMES.SUGGESTIONS_EXPIRE },
  );
  await q.upsertJobScheduler(
    AI_JOB_NAMES.PURGE_OUTPUTS,
    { pattern: "30 4 * * *", tz: "Africa/Abidjan" },
    { name: AI_JOB_NAMES.PURGE_OUTPUTS },
  );
  await q.upsertJobScheduler(
    AI_JOB_NAMES.ASSISTANT_PURGE,
    { pattern: "45 4 * * *", tz: "Africa/Abidjan" },
    { name: AI_JOB_NAMES.ASSISTANT_PURGE },
  );
}
