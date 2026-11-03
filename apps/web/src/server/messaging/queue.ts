// Producteur de la file BullMQ "messages" (RG-M11-01 : job ajouté "après commit" de la
// transaction qui a appelé `messagingEnqueue`). Le nom de la file et du job doit rester
// identique à `apps/worker/src/queues/messages.ts`, qui la consomme.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { DomainError } from "@atelieros/core";

export const MESSAGES_QUEUE_NAME = "messages";
export const MESSAGES_SEND_JOB_NAME = "messages.send";

/** Modèle Meta à transmettre tel quel à WhatsApp Cloud (RG-M11-10). Doit rester aligné avec le worker. */
export interface WhatsappSendJobPayload {
  templateName: string;
  templateLanguage?: string;
  templateParams?: string[];
}

let redisConnection: IORedis | undefined;
let messagesQueue: Queue | undefined;

const QUEUE_WAIT_MS = 3_000;

function getRedisConnection(): IORedis {
  if (redisConnection) return redisConnection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new DomainError(
      "messaging.redis_url_missing",
      "REDIS_URL est requis pour mettre un message en file.",
    );
  }
  redisConnection = new IORedis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: QUEUE_WAIT_MS,
    retryStrategy(times) {
      return times > 2 ? null : Math.min(times * 200, 1_000);
    },
  });
  redisConnection.on("error", () => undefined);
  return redisConnection;
}

/** Abandonne un client bloqué pour que l'appel suivant reparte de zéro. */
function dropQueue(): void {
  const conn = redisConnection;
  redisConnection = undefined;
  messagesQueue = undefined;
  conn?.disconnect();
}

function getMessagesQueue(): Queue {
  messagesQueue ??= new Queue(MESSAGES_QUEUE_NAME, { connection: getRedisConnection() });
  return messagesQueue;
}

/** `jobId = message.id` (RG-M11-01) : un retry BullMQ sur le même id ne duplique jamais le job. */
export async function enqueueMessageSendJob(
  messageId: string,
  delayMs = 0,
  whatsapp?: WhatsappSendJobPayload,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = getMessagesQueue()
    .add(
      MESSAGES_SEND_JOB_NAME,
      { messageId, ...(whatsapp ? { whatsapp } : {}) },
      {
        jobId: messageId,
        attempts: 5,
        backoff: { type: "atelieros-messaging" },
        // M03 RG-M03-08 : message transactionnel différé à 07:00 hors fenêtre 22:00-07:00.
        ...(delayMs > 0 ? { delay: delayMs } : {}),
      },
    )
    .finally(() => {
      if (timer) clearTimeout(timer);
    });
  // Si Redis est arrêté, BullMQ attend sans fin (maxRetriesPerRequest: null). On lâche au bout
  // de quelques secondes pour que l'écran qui a demandé l'envoi ne reste pas bloqué.
  pending.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DomainError("messaging.queue_unavailable", "Le service d'envoi ne répond pas."));
    }, QUEUE_WAIT_MS);
  });
  try {
    await Promise.race([pending, timeout]);
  } catch (error) {
    dropQueue();
    throw error;
  }
}
