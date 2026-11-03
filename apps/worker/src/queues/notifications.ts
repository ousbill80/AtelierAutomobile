// PWA — `notifications.push` (chaque minute) : les notifications in-app récentes sont poussées
// sur les appareils abonnés (Web Push), une seule fois (`Notification.pushedAt`).
import { Queue } from "bullmq";
import { createRedisConnection } from "../redis";

export const NOTIFICATIONS_QUEUE_NAME = "notifications";

export const NOTIFICATIONS_JOB_NAMES = {
  PUSH: "notifications.push",
} as const;

let queue: Queue | undefined;

export function getNotificationsQueue(): Queue {
  queue ??= new Queue(NOTIFICATIONS_QUEUE_NAME, { connection: createRedisConnection() });
  return queue;
}

export async function scheduleNotificationJobs(): Promise<void> {
  await getNotificationsQueue().upsertJobScheduler(
    NOTIFICATIONS_JOB_NAMES.PUSH,
    { pattern: "* * * * *" },
    { name: NOTIFICATIONS_JOB_NAMES.PUSH },
  );
}
