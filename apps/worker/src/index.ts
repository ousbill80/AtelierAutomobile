import { Worker, type Job } from "bullmq";
import { applyJitter, retryBackoffMs } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { logger } from "./logger";
import { createRedisConnection } from "./redis";
import { MESSAGES_QUEUE_NAME, type MessagesSendJobData } from "./queues/messages";
import { processMessagesSendJob } from "./jobs/messagesSend";

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

process.on("SIGTERM", () => {
  void messagesWorker.close();
});
