// Doit correspondre à apps/web/src/server/messaging/queue.ts (producteur).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const MESSAGES_QUEUE_NAME = "messages";
export const MESSAGES_SEND_JOB_NAME = "messages.send";

export interface MessagesSendJobData {
  messageId: string;
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
