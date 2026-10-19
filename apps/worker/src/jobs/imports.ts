/**
 * Consommateur BullMQ de la file « imports » (RG-M13-24, §9 du PRD). Chaque
 * job ajouté par `apps/web` (`import.run`, pilote `bullmq`) est traité ici en
 * appelant `processImportRunJob` (@atelieros/import) — jamais directement par
 * le routeur tRPC (CLAUDE.md : « Routeurs, jobs et API ne font qu'orchestrer »).
 */
import { Worker, type ConnectionOptions } from "bullmq";
import { IMPORT_QUEUE_NAME, processImportRunJob, type RunImportJobData } from "@atelieros/import";
import { logger } from "../logger";
import { getObjectStorage } from "../storage";

function parseRedisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
  };
}

/** Démarre le worker de la file « imports ». Retourne l'instance pour un arrêt propre (`close()`). */
export function startImportsWorker(): Worker<RunImportJobData> {
  const connection = parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6380");

  const worker = new Worker<RunImportJobData>(
    IMPORT_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.data.jobId }, "import: traitement démarré");
      await processImportRunJob(job.data, { storage: getObjectStorage() });
      logger.info({ jobId: job.data.jobId }, "import: traitement terminé");
    },
    { connection },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.data.jobId, err }, "import: traitement en échec");
  });

  return worker;
}
