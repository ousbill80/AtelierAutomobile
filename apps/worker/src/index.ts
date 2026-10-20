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
  const { processCollectionsPromisesJob, processReceivablesAgeJob } =
    await import("./jobs/receivablesAge");
  const { REPORTS_JOB_NAMES, REPORTS_QUEUE_NAME, scheduleReportJobs } =
    await import("./queues/reports");
  const { processDigestOwnerJob } = await import("./jobs/digestOwner");
  const { processAlertsScanJob } = await import("./jobs/alertsScan");
  const { APPOINTMENTS_JOB_NAMES, APPOINTMENTS_QUEUE_NAME, scheduleAppointmentJobs } =
    await import("./queues/appointments");
  const { processDailyAgendaJob, processMarkNoShowJob, processUnconfirmedCheckJob } =
    await import("./jobs/appointments");
  const { REPAIR_ORDERS_JOB_NAMES, REPAIR_ORDERS_QUEUE_NAME, scheduleRepairOrderJobs } =
    await import("./queues/repairOrders");
  const { processRepairOrdersLateCheckJob, processRepairOrdersReadyFollowupJob } =
    await import("./jobs/repairOrders");
  const { STOCK_JOB_NAMES, STOCK_QUEUE_NAME, scheduleStockJobs } = await import("./queues/stock");
  const {
    processPurchaseLateAlertsJob,
    processStockIntegrityCheckJob,
    processStockReorderSuggestionsJob,
  } = await import("./jobs/stockJobs");
  const { QUOTES_JOB_NAMES, QUOTES_QUEUE_NAME, scheduleQuoteJobs } =
    await import("./queues/quotes");
  const { processQuotesExpireJob } = await import("./jobs/quotes");
  const { CASH_JOB_NAMES, CASH_QUEUE_NAME, scheduleCashJobs } = await import("./queues/cash");
  const { processCashCheckUnclosedJob } = await import("./jobs/cashJobs");
  const { WORKSHOP_JOB_NAMES, WORKSHOP_QUEUE_NAME, scheduleWorkshopJobs } =
    await import("./queues/workshop");
  const { processWorkshopCloseStaleJob, processWorkshopLateAlertsJob } =
    await import("./jobs/workshopJobs");
  const { CLAIMS_JOB_NAMES, CLAIMS_QUEUE_NAME, scheduleClaimsJobs } =
    await import("./queues/claims");
  const { processClaimsPlanFollowUpsJob, processClaimsDispatchFollowUpsJob } =
    await import("./jobs/claimsJobs");
  const { FNE_JOB_NAMES, FNE_QUEUE_NAME, scheduleFneJobs } = await import("./queues/fne");
  type FneCertifyJobData = import("./queues/fne").FneCertifyJobData;
  const { processFneCertifyJob, processFneRetryJob } = await import("./jobs/fne");
  const { AI_JOB_NAMES, AI_QUEUE_NAME, scheduleAiJobs } = await import("./queues/ai");
  const {
    processAiAnomaliesJob,
    processAiLearnReminderTimingJob,
    processAiPurgeOutputsJob,
    processAiSuggestionsExpireJob,
  } = await import("./jobs/aiJobs");
  const { processAiAssistantPurgeJob } = await import("./jobs/aiAssistantPurge");
  const { PAYMENTS_JOB_NAMES, PAYMENTS_QUEUE_NAME, schedulePaymentJobs } =
    await import("./queues/payments");
  const { processPaymentLinksExpireJob, processPaymentsReconcileJob } =
    await import("./jobs/payments");

  const { AUTOMATIONS_JOB_NAMES, AUTOMATIONS_QUEUE_NAME, scheduleAutomationJobs } =
    await import("./queues/automations");
  const { processAutomationsDispatchJob } = await import("./jobs/automations");

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
        case REMINDERS_JOB_NAMES.RECEIVABLES_AGE:
          return processReceivablesAgeJob();
        case REMINDERS_JOB_NAMES.COLLECTIONS_PROMISES:
          return processCollectionsPromisesJob();
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

  // M03 §9 : absences automatiques, agenda du jour, confirmations à obtenir.
  await scheduleAppointmentJobs();

  const appointmentsWorker = new Worker(
    APPOINTMENTS_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case APPOINTMENTS_JOB_NAMES.MARK_NO_SHOW:
          return processMarkNoShowJob();
        case APPOINTMENTS_JOB_NAMES.DAILY_AGENDA:
          return processDailyAgendaJob();
        case APPOINTMENTS_JOB_NAMES.UNCONFIRMED_CHECK:
          return processUnconfirmedCheckJob();
        default:
          logger.warn({ jobName: job.name }, "appointments : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );

  // M04 §9 : OR en retard sur la promesse, véhicules prêts non récupérés, gardiennage.
  await scheduleRepairOrderJobs();

  const repairOrdersWorker = new Worker(
    REPAIR_ORDERS_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case REPAIR_ORDERS_JOB_NAMES.LATE_CHECK:
          return processRepairOrdersLateCheckJob();
        case REPAIR_ORDERS_JOB_NAMES.READY_FOLLOWUP:
          return processRepairOrdersReadyFollowupJob();
        default:
          logger.warn({ jobName: job.name }, "repairOrders : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );
  appointmentsWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "appointments : un job a échoué");
  });
  repairOrdersWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "repairOrders : un job a échoué");
  });

  // M07 §9 : suggestions de réapprovisionnement, contrôle d'intégrité, commandes en retard.
  await scheduleStockJobs();

  const stockWorker = new Worker(
    STOCK_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case STOCK_JOB_NAMES.REORDER_SUGGESTIONS:
          return processStockReorderSuggestionsJob();
        case STOCK_JOB_NAMES.INTEGRITY_CHECK:
          return processStockIntegrityCheckJob();
        case STOCK_JOB_NAMES.PURCHASE_LATE_ALERTS:
          return processPurchaseLateAlertsJob();
        default:
          logger.warn({ jobName: job.name }, "stock : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );
  stockWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "stock : un job a échoué");
  });

  // M05 §9 : expiration des devis (RG-M05-08).
  await scheduleQuoteJobs();

  const quotesWorker = new Worker(
    QUOTES_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === QUOTES_JOB_NAMES.EXPIRE) return processQuotesExpireJob();
      logger.warn({ jobName: job.name }, "quotes : job inconnu, ignoré");
      return undefined;
    },
    { connection: createRedisConnection() },
  );
  quotesWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "quotes : un job a échoué");
  });

  // M08 §9 : caisse non clôturée à 23:00 (RG-M08-29).
  await scheduleCashJobs();

  const cashWorker = new Worker(
    CASH_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === CASH_JOB_NAMES.CHECK_UNCLOSED) return processCashCheckUnclosedJob();
      logger.warn({ jobName: job.name }, "cash : job inconnu, ignoré");
      return undefined;
    },
    { connection: createRedisConnection() },
  );
  cashWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "cash : un job a échoué");
  });

  // M06 §9 : clôtures automatiques des pointages et alertes de retard.
  await scheduleWorkshopJobs();

  const workshopWorker = new Worker(
    WORKSHOP_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === WORKSHOP_JOB_NAMES.CLOSE_STALE) return processWorkshopCloseStaleJob();
      if (job.name === WORKSHOP_JOB_NAMES.LATE_ALERTS) return processWorkshopLateAlertsJob();
      logger.warn({ jobName: job.name }, "workshop : job inconnu, ignoré");
      return undefined;
    },
    { connection: createRedisConnection() },
  );
  workshopWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "workshop : un job a échoué");
  });

  // M16 §9 : relances de l'assureur (accord, expert, règlement).
  await scheduleClaimsJobs();

  const claimsWorker = new Worker(
    CLAIMS_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === CLAIMS_JOB_NAMES.PLAN_FOLLOWUPS) return processClaimsPlanFollowUpsJob();
      if (job.name === CLAIMS_JOB_NAMES.DISPATCH_FOLLOWUPS)
        return processClaimsDispatchFollowUpsJob();
      logger.warn({ jobName: job.name }, "claims : job inconnu, ignoré");
      return undefined;
    },
    { connection: createRedisConnection() },
  );
  claimsWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "claims : un job a échoué");
  });

  // M08 §9 : certification FNE à l'émission et reprises toutes les 10 min (RG-M08-15/16).
  await scheduleFneJobs();

  const fneWorker = new Worker(
    FNE_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case FNE_JOB_NAMES.CERTIFY:
          return processFneCertifyJob(job.data as FneCertifyJobData);
        case FNE_JOB_NAMES.RETRY:
          return processFneRetryJob();
        default:
          logger.warn({ jobName: job.name }, "fne : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );
  fneWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "fne : un job a échoué");
  });

  // M08 §9 : rapprochement des liens de paiement (30 min) et expiration (horaire), RG-M08-25.
  await schedulePaymentJobs();

  const paymentsWorker = new Worker(
    PAYMENTS_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case PAYMENTS_JOB_NAMES.RECONCILE:
          return processPaymentsReconcileJob();
        case PAYMENTS_JOB_NAMES.EXPIRE_LINKS:
          return processPaymentLinksExpireJob();
        default:
          logger.warn({ jobName: job.name }, "payments : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );
  paymentsWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "payments : un job a échoué");
  });

  // M17 §9 : anomalies, expiration des suggestions, purges (sorties IA, fils d'assistant).
  await scheduleAiJobs();
  const aiWorker = new Worker(
    AI_QUEUE_NAME,
    async (job: Job) => {
      switch (job.name) {
        case AI_JOB_NAMES.ANOMALIES:
          return processAiAnomaliesJob();
        case AI_JOB_NAMES.SUGGESTIONS_EXPIRE:
          return processAiSuggestionsExpireJob();
        case AI_JOB_NAMES.PURGE_OUTPUTS:
          return processAiPurgeOutputsJob();
        case AI_JOB_NAMES.LEARN_REMINDER_TIMING:
          return processAiLearnReminderTimingJob();
        case AI_JOB_NAMES.ASSISTANT_PURGE:
          return processAiAssistantPurgeJob();
        default:
          logger.warn({ jobName: job.name }, "ai : job inconnu, ignoré");
          return undefined;
      }
    },
    { connection: createRedisConnection() },
  );
  aiWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "ai : un job a échoué");
  });

  // M17 RG-M17-24 : automatisations « si… alors… » (chaque minute + jobs immédiats).
  await scheduleAutomationJobs();

  const automationsWorker = new Worker(
    AUTOMATIONS_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === AUTOMATIONS_JOB_NAMES.DISPATCH) return processAutomationsDispatchJob();
      logger.warn({ jobName: job.name }, "automations : job inconnu, ignoré");
      return undefined;
    },
    // Un seul traitement à la fois : les jobs immédiats et le cron ne se chevauchent pas.
    { connection: createRedisConnection(), concurrency: 1 },
  );
  automationsWorker.on("failed", (job, error) => {
    logger.error({ jobName: job?.name, error: error.message }, "automations : un job a échoué");
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker: arrêt demandé");
    await Promise.all([
      importsWorker.close(),
      messagesWorker.close(),
      remindersWorker.close(),
      reportsWorker.close(),
      appointmentsWorker.close(),
      repairOrdersWorker.close(),
      stockWorker.close(),
      quotesWorker.close(),
      cashWorker.close(),
      workshopWorker.close(),
      claimsWorker.close(),
      fneWorker.close(),
      paymentsWorker.close(),
      aiWorker.close(),
      automationsWorker.close(),
    ]);
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
