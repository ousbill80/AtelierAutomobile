// Producteur de la file BullMQ "messages" (RG-M11-01 : job ajouté "après commit" de la
// transaction qui a appelé `messagingEnqueue`). Le nom de la file et du job doit rester
// identique à `apps/worker/src/queues/messages.ts`, qui la consomme.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { DomainError } from "@atelieros/core";

export const MESSAGES_QUEUE_NAME = "messages";
export const MESSAGES_SEND_JOB_NAME = "messages.send";

let redisConnection: IORedis | undefined;
let messagesQueue: Queue | undefined;

function getRedisConnection(): IORedis {
  if (redisConnection) return redisConnection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new DomainError(
      "messaging.redis_url_missing",
      "REDIS_URL est requis pour mettre un message en file.",
    );
  }
  redisConnection = new IORedis(url, { maxRetriesPerRequest: null });
  return redisConnection;
}

function getMessagesQueue(): Queue {
  messagesQueue ??= new Queue(MESSAGES_QUEUE_NAME, { connection: getRedisConnection() });
  return messagesQueue;
}

/** `jobId = message.id` (RG-M11-01) : un retry BullMQ sur le même id ne duplique jamais le job. */
export async function enqueueMessageSendJob(messageId: string): Promise<void> {
  await getMessagesQueue().add(
    MESSAGES_SEND_JOB_NAME,
    { messageId },
    { jobId: messageId, attempts: 5, backoff: { type: "atelieros-messaging" } },
  );
}
