// Doit correspondre à apps/web/src/server/messaging/queue.ts (producteur).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const MESSAGES_QUEUE_NAME = "messages";
export const MESSAGES_SEND_JOB_NAME = "messages.send";
/** Job récurrent : rescue des messages QUEUED orphelins (fix bug 2 — Redis en panne au moment de l'enqueue). */
export const MESSAGES_RESCUE_JOB_NAME = "messages.rescue";

/** Données de job du rescue (aucune payload requise). */
export type MessagesRescueJobData = Record<string, never>;

export interface MessagesSendJobData {
  messageId: string;
  /** Présent quand l'envoi WhatsApp doit partir comme modèle Meta, pas comme texte libre. */
  whatsapp?: {
    templateName: string;
    templateLanguage?: string;
    templateParams?: string[];
  };
}

let queue: Queue<MessagesSendJobData> | undefined;

export function getMessagesQueue(): Queue<MessagesSendJobData> {
  queue ??= new Queue<MessagesSendJobData>(MESSAGES_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return queue;
}

/** `jobId = message.id` (RG-M11-01) : utilisé aussi pour les messages de repli (RG-M11-05). */
export async function enqueueMessageSendJob(messageId: string): Promise<void> {
  await getMessagesQueue().add(
    MESSAGES_SEND_JOB_NAME,
    { messageId },
    { jobId: messageId, attempts: 5, backoff: { type: "atelieros-messaging" } },
  );
}

/**
 * Planifie le job de rescue (toutes les 5 min). `jobId` fixe → pas de doublon au
 * redémarrage.
 */
export async function scheduleMessagesRescueJob(): Promise<void> {
  // Le rescue n'a pas de payload `messageId` : on caste la queue en `Queue<unknown>` pour
  // éviter une erreur TS de type sur `data: {}`.
  const q = getMessagesQueue() as Queue<unknown>;
  await q.upsertJobScheduler(
    MESSAGES_RESCUE_JOB_NAME,
    { pattern: "*/5 * * * *" },
    { name: MESSAGES_RESCUE_JOB_NAME, data: {} },
  );
}
