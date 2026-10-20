// M17 RG-M17-24 — file « automations » : `automations.dispatch` chaque minute (filet de
// sécurité) et à la demande (job immédiat ajouté par apps/web après un événement déclencheur
// ou l'acceptation d'une proposition). Doit correspondre à apps/web/src/server/automations/queue.ts.
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const AUTOMATIONS_QUEUE_NAME = "automations";

export const AUTOMATIONS_JOB_NAMES = {
  DISPATCH: "automations.dispatch",
} as const;

let queue: Queue | undefined;

export function getAutomationsQueue(): Queue {
  queue ??= new Queue(AUTOMATIONS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleAutomationJobs(): Promise<void> {
  await getAutomationsQueue().upsertJobScheduler(
    AUTOMATIONS_JOB_NAMES.DISPATCH,
    { pattern: "* * * * *" },
    { name: AUTOMATIONS_JOB_NAMES.DISPATCH },
  );
}
