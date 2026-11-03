// PWA — distribution des notifications in-app sur les appareils abonnés (Web Push).
// Appelé par le job `notifications.push` (worker, chaque minute) et par l'envoi de test.
// Le fournisseur est injecté (structurellement compatible avec `PushProvider` de
// @atelieros/integrations) : ce paquet ne dépend d'aucun service externe.
import { buildPushContent, PUSH_MAX_AGE_MINUTES, subscriptionAfterAttempt } from "@atelieros/core";
import { adminDb } from "./client";
import { db } from "./tenant";

export interface PushSender {
  send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    payload: { title: string; body?: string | null; link?: string | null; tag?: string },
  ): Promise<{ status: "sent" | "gone" | "failed" }>;
}

export interface PushDeliveryReport {
  notifications: number;
  sent: number;
  removed: number;
  failed: number;
}

type TenantDb = ReturnType<typeof db.forTenant>;

/** Pousse une notification sur tous les appareils du membre et marque `pushedAt`. */
export async function pushNotificationToDevices(
  tenantDb: TenantDb,
  notification: {
    id: string;
    membershipId: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
  },
  sender: PushSender,
  now: Date,
): Promise<Omit<PushDeliveryReport, "notifications">> {
  const report = { sent: 0, removed: 0, failed: 0 };
  const subscriptions = await tenantDb.pushSubscription.findMany({
    where: { membershipId: notification.membershipId },
  });
  const content = buildPushContent(notification);
  for (const subscription of subscriptions) {
    const result = await sender.send(subscription, content);
    const next = subscriptionAfterAttempt(result.status, subscription.failureCount);
    if (next.action === "delete") {
      await tenantDb.pushSubscription.deleteMany({ where: { id: subscription.id } });
      report.removed += 1;
      if (result.status === "failed") report.failed += 1;
    } else {
      await tenantDb.pushSubscription.updateMany({
        where: { id: subscription.id },
        data: {
          failureCount: next.failureCount,
          ...(result.status === "sent" ? { lastSuccessAt: now } : {}),
        },
      });
      if (result.status === "sent") report.sent += 1;
      else report.failed += 1;
    }
  }
  await tenantDb.notification.updateMany({
    where: { id: notification.id, pushedAt: null },
    data: { pushedAt: now },
  });
  return report;
}

/**
 * Notifications récentes pas encore poussées, toutes organisations confondues (job système) :
 * la recherche des organisations concernées passe par adminDb, l'envoi par `db.forTenant`.
 */
export async function deliverPendingPushes(
  sender: PushSender,
  now: Date,
  options: { batchSize?: number } = {},
): Promise<PushDeliveryReport> {
  const since = new Date(now.getTime() - PUSH_MAX_AGE_MINUTES * 60_000);
  const report: PushDeliveryReport = { notifications: 0, sent: 0, removed: 0, failed: 0 };
  const orgs = await adminDb.notification.findMany({
    where: { pushedAt: null, createdAt: { gte: since } },
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  for (const { organizationId } of orgs) {
    const tenantDb = db.forTenant({ organizationId });
    const pending = await tenantDb.notification.findMany({
      where: { pushedAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: options.batchSize ?? 200,
    });
    for (const notification of pending) {
      const result = await pushNotificationToDevices(tenantDb, notification, sender, now);
      report.notifications += 1;
      report.sent += result.sent;
      report.removed += result.removed;
      report.failed += result.failed;
    }
  }
  return report;
}
