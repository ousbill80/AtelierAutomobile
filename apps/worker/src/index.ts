import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `apps/web` (Next.js) charge `.env` automatiquement ; ce process `tsx` ne le
// fait pas — on le charge nous-mêmes, avant tout import de module applicatif
// (`@atelieros/db` construit son client Prisma dès son évaluation), pour que
// `pnpm dev` fonctionne sans étape manuelle (DATABASE_URL, REDIS_URL, S3_*...).
// Les imports statiques ES étant hoistés/évalués avant le corps de ce
// fichier, les modules applicatifs sont chargés dynamiquement ci-dessous,
// une fois l'environnement en place.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(dirname, "../../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  const { Worker } = await import("bullmq");
  type Job<T = unknown> = import("bullmq").Job<T>;
  const { applyJitter, retryBackoffMs } = await import("@atelieros/core");
  const { adminDb } = await import("@atelieros/db");
  const { logger } = await import("./logger");
  const { createRedisConnection } = await import("./redis");
  const { startImportsWorker } = await import("./jobs/imports");
  const { MESSAGES_QUEUE_NAME } = await import("./queues/messages");
  type MessagesSendJobData = import("./queues/messages").MessagesSendJobData;
  const { processMessagesSendJob } = await import("./jobs/messagesSend");
  const { REMINDERS_JOB_NAMES, REMINDERS_QUEUE_NAME, scheduleReminderJobs } =
    await import("./queues/reminders");
  const { processRemindersPlanJob } = await import("./jobs/remindersPlan");
  const { processRemindersDispatchJob } = await import("./jobs/remindersDispatch");
  const { processRemindersOnEventJob } = await import("./jobs/remindersOnEvent");
  const { processRemindersOutcomesJob } = await import("./jobs/remindersOutcomes");
  const { processVehiclesEstimateMileageJob } = await import("./jobs/vehiclesEstimateMileage");
  const { REPORTS_JOB_NAMES, REPORTS_QUEUE_NAME, scheduleReportJobs } =
    await import("./queues/reports");
  const { processDigestOwnerJob } = await import("./jobs/digestOwner");
  const { processAlertsScanJob } = await import("./jobs/alertsScan");

  logger.info("AtelierOS worker démarré");

  // RG-M11-26 : un fournisseur `console` actif ne doit jamais tourner en production.
  if (process.env.APP_ENV === "production") {
    const consoleConfig = await adminDb.channelConfig.findFirst({
      where: { provider: "console", isActive: true },
    });
    if (consoleConfig) {
      throw new Error(
        `Fournisseur de messagerie "console" actif (organisation ${consoleConfig.organizationId}) alors que APP_ENV=production. Démarrage refusé.`,
      );
    }
  }

  const importsWorker = startImportsWorker();
  logger.info({ queue: "imports" }, "worker: file « imports » prête");

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

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker: arrêt demandé");
    await Promise.all([
      importsWorker.close(),
      messagesWorker.close(),
      remindersWorker.close(),
      reportsWorker.close(),
    ]);
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
