// §9.3 — files et cadences du moteur de relances (M10). Une seule file BullMQ avec des
// jobs répétables ; `apps/worker/src/index.ts` route chaque nom de job vers son handler.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const REMINDERS_QUEUE_NAME = "reminders";

export const REMINDERS_JOB_NAMES = {
  PLAN: "reminders.plan",
  DISPATCH: "reminders.dispatch",
  OUTCOMES: "reminders.outcomes",
  ON_EVENT: "reminders.on_event",
  ESTIMATE_MILEAGE: "vehicles.estimate_mileage",
  RECEIVABLES_AGE: "receivables.age",
  COLLECTIONS_PROMISES: "collections.promises",
} as const;

let queue: Queue | undefined;

export function getRemindersQueue(): Queue {
  queue ??= new Queue(REMINDERS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

/**
 * Enregistre les jobs répétables (§9.1-9.3). `jobId` fixe évite la duplication au
 * redémarrage : BullMQ remplace le planning existant pour le même `jobId` plutôt que
 * d'en ajouter un second.
 */
export async function scheduleReminderJobs(): Promise<void> {
  const queue = getRemindersQueue();
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.PLAN,
    { pattern: "0 * * * *" },
    {
      name: REMINDERS_JOB_NAMES.PLAN,
    },
  );
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.DISPATCH,
    { pattern: "*/5 * * * *" },
    {
      name: REMINDERS_JOB_NAMES.DISPATCH,
    },
  );
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.OUTCOMES,
    { pattern: "30 3 * * *" },
    {
      name: REMINDERS_JOB_NAMES.OUTCOMES,
    },
  );
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.ON_EVENT,
    { pattern: "*/2 * * * *" },
    {
      name: REMINDERS_JOB_NAMES.ON_EVENT,
    },
  );
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.ESTIMATE_MILEAGE,
    { pattern: "0 2 * * *" },
    { name: REMINDERS_JOB_NAMES.ESTIMATE_MILEAGE },
  );
  // M09 §9 : vieillissement des créances (01:00) puis évaluation des promesses (01:15).
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.RECEIVABLES_AGE,
    { pattern: "0 1 * * *" },
    { name: REMINDERS_JOB_NAMES.RECEIVABLES_AGE },
  );
  await queue.upsertJobScheduler(
    REMINDERS_JOB_NAMES.COLLECTIONS_PROMISES,
    { pattern: "15 1 * * *" },
    { name: REMINDERS_JOB_NAMES.COLLECTIONS_PROMISES },
  );
}
