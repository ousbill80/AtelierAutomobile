import { Worker, type Job } from "bullmq";
import { applyJitter, retryBackoffMs } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { logger } from "./logger";
import { createRedisConnection } from "./redis";
import { MESSAGES_QUEUE_NAME, type MessagesSendJobData } from "./queues/messages";
import { processMessagesSendJob } from "./jobs/messagesSend";
import {
  REMINDERS_JOB_NAMES,
  REMINDERS_QUEUE_NAME,
  scheduleReminderJobs,
} from "./queues/reminders";
import { processRemindersPlanJob } from "./jobs/remindersPlan";
import { processRemindersDispatchJob } from "./jobs/remindersDispatch";
import { processRemindersOnEventJob } from "./jobs/remindersOnEvent";
import { processRemindersOutcomesJob } from "./jobs/remindersOutcomes";
import { processVehiclesEstimateMileageJob } from "./jobs/vehiclesEstimateMileage";
import { REPORTS_JOB_NAMES, REPORTS_QUEUE_NAME, scheduleReportJobs } from "./queues/reports";
import { processDigestOwnerJob } from "./jobs/digestOwner";
import { processAlertsScanJob } from "./jobs/alertsScan";

logger.info("AtelierOS worker démarré");

/** RG-M11-26 : un fournisseur `console` actif ne doit jamais tourner en production. */
async function guardAgainstConsoleProviderInProduction(): Promise<void> {
  if (process.env.APP_ENV !== "production") return;
  const consoleConfig = await adminDb.channelConfig.findFirst({
    where: { provider: "console", isActive: true },
  });
  if (consoleConfig) {
    throw new Error(
      `Fournisseur de messagerie "console" actif (organisation ${consoleConfig.organizationId}) alors que APP_ENV=production. Démarrage refusé.`,
    );
  }
}

await guardAgainstConsoleProviderInProduction();

const messagesWorker = new Worker<MessagesSendJobData>(
  MESSAGES_QUEUE_NAME,
  (job: Job<MessagesSendJobData>, token?: string) => processMessagesSendJob(job, token),
  {
    connection: createRedisConnection(),
    settings: {
      // RG-M11-07 : 30s, 2min, 8min, 30min, 2h (+ gigue ±20 %).
      backoffStrategy: (attemptsMade: number) =>
        applyJitter(retryBackoffMs(attemptsMade), Math.random() * 2 - 1),
    },
  },
);

messagesWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error: error.message }, "messages.send a échoué");
});

// §9.1-9.3 (M10) : planification, envoi, consolidation des résultats, consommation des
// événements et estimation du kilométrage. Une seule file à jobs répétables ; le routage se
// fait par nom de job (chaque job parcourt lui-même toutes les organisations).
await scheduleReminderJobs();

const remindersWorker = new Worker(
  REMINDERS_QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case REMINDERS_JOB_NAMES.PLAN:
        return processRemindersPlanJob();
      case REMINDERS_JOB_NAMES.DISPATCH:
        return processRemindersDispatchJob();
      case REMINDERS_JOB_NAMES.OUTCOMES:
        return processRemindersOutcomesJob();
      case REMINDERS_JOB_NAMES.ON_EVENT:
        return processRemindersOnEventJob();
      case REMINDERS_JOB_NAMES.ESTIMATE_MILEAGE:
        return processVehiclesEstimateMileageJob();
      default:
        logger.warn({ jobName: job.name }, "reminders : job inconnu, ignoré");
        return undefined;
    }
  },
  { connection: createRedisConnection() },
);

remindersWorker.on("failed", (job, error) => {
  logger.error({ jobName: job?.name, error: error.message }, "reminders : un job a échoué");
});

// M12 §9 (partie 1, étape 2.4) : résumé quotidien gérant et alertes système.
await scheduleReportJobs();

const reportsWorker = new Worker(
  REPORTS_QUEUE_NAME,
  async (job: Job) => {
    switch (job.name) {
      case REPORTS_JOB_NAMES.DIGEST_OWNER:
        return processDigestOwnerJob();
      case REPORTS_JOB_NAMES.ALERTS_SCAN:
        return processAlertsScanJob();
      default:
        logger.warn({ jobName: job.name }, "reports : job inconnu, ignoré");
        return undefined;
    }
  },
  { connection: createRedisConnection() },
);

reportsWorker.on("failed", (job, error) => {
  logger.error({ jobName: job?.name, error: error.message }, "reports : un job a échoué");
});

process.on("SIGTERM", () => {
  void messagesWorker.close();
  void remindersWorker.close();
  void reportsWorker.close();
});
