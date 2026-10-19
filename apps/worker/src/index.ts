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
  const { logger } = await import("./logger");
  const { startImportsWorker } = await import("./jobs/imports");
  const { applyJitter, retryBackoffMs } = await import("@atelieros/core");
  const { adminDb } = await import("@atelieros/db");
  const { Worker } = await import("bullmq");
  const { createRedisConnection } = await import("./redis");
  const { MESSAGES_QUEUE_NAME } = await import("./queues/messages");
  const { processMessagesSendJob } = await import("./jobs/messagesSend");

  logger.info("AtelierOS worker démarré");

  const importsWorker = startImportsWorker();
  logger.info({ queue: "imports" }, "worker: file « imports » prête");

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

  const messagesWorker = new Worker(
    MESSAGES_QUEUE_NAME,
    (job, token?: string) => processMessagesSendJob(job, token),
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
  logger.info({ queue: MESSAGES_QUEUE_NAME }, "worker: file « messages » prête");

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker: arrêt demandé");
    await importsWorker.close();
    await messagesWorker.close();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
