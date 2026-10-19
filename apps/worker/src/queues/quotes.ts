// M05 §9 — file `quotes` : `quotes.expire` (quotidien 00:30, fuseau de l'organisation —
// Africa/Abidjan = UTC, les autres fuseaux sont traités au même instant).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const QUOTES_QUEUE_NAME = "quotes";

export const QUOTES_JOB_NAMES = {
  EXPIRE: "quotes.expire",
} as const;

let queue: Queue | undefined;

export function getQuotesQueue(): Queue {
  queue ??= new Queue(QUOTES_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleQuoteJobs(): Promise<void> {
  const queue = getQuotesQueue();
  await queue.upsertJobScheduler(
    QUOTES_JOB_NAMES.EXPIRE,
    { pattern: "30 0 * * *" },
    { name: QUOTES_JOB_NAMES.EXPIRE },
  );
}
