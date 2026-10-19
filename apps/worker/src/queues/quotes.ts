// M05 §9 — tâche planifiée des devis : `quotes.expire` (RG-M05-08). Exécutée toutes les heures à
// la demi-heure : chaque organisation n'expire ses devis qu'une fois sa journée locale changée
// (00:30 en Côte d'Ivoire), et le traitement est idempotent.
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
  await getQuotesQueue().upsertJobScheduler(
    QUOTES_JOB_NAMES.EXPIRE,
    { pattern: "30 * * * *" },
    { name: QUOTES_JOB_NAMES.EXPIRE },
  );
}
