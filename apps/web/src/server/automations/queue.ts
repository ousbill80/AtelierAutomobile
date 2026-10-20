// M17 RG-M17-24 — producteur de la file BullMQ « automations » : demande un passage immédiat
// de `automations.dispatch` (apps/worker) après un événement déclencheur ou l'acceptation
// d'une proposition, en plus du passage de chaque minute. Nom de file et de job identiques à
// `apps/worker/src/queues/automations.ts`. Ne bloque jamais l'action métier : une file
// indisponible est seulement journalisée (le cron rattrape).
import { db } from "@atelieros/db";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const AUTOMATIONS_QUEUE_NAME = "automations";
export const AUTOMATIONS_DISPATCH_JOB_NAME = "automations.dispatch";

let connection: IORedis | undefined;
let queue: Queue | undefined;

function getQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  connection ??= new IORedis(url, { maxRetriesPerRequest: null });
  queue ??= new Queue(AUTOMATIONS_QUEUE_NAME, { connection });
  return queue;
}

/**
 * Ajoute un job immédiat si l'organisation a au moins une règle active pour ce déclencheur
 * (ou, sans déclencheur, toujours). À appeler après la transaction qui a émis l'événement ;
 * depuis l'intérieur d'une transaction, passer `delayMs` (le passage de chaque minute rattrape).
 */
export async function requestAutomationDispatch(
  scope?: { organizationId: string; trigger: string },
  options: { delayMs?: number } = {},
): Promise<void> {
  try {
    if (scope) {
      const active = await db
        .forTenant({ organizationId: scope.organizationId })
        .automationRule.count({ where: { isActive: true, trigger: scope.trigger } });
      if (!active) return;
    }
    await getQueue()?.add(
      AUTOMATIONS_DISPATCH_JOB_NAME,
      {},
      {
        removeOnComplete: 100,
        removeOnFail: 100,
        ...(options.delayMs ? { delay: options.delayMs } : {}),
      },
    );
  } catch (error) {
    console.warn(
      "automations : demande de passage immédiat impossible (le cron rattrapera)",
      error instanceof Error ? error.message : error,
    );
  }
}
