// PWA — job `notifications.push` : distribue les notifications in-app récentes sur les
// appareils abonnés. Fournisseur Web Push si les clés VAPID sont configurées, sinon console.
import { deliverPendingPushes } from "@atelieros/db";
import { pushProviderFromEnv, type PushProvider } from "@atelieros/integrations";
import { logger } from "../logger";

let provider: PushProvider | undefined;

export async function processNotificationsPushJob(now: Date = new Date()) {
  provider ??= pushProviderFromEnv();
  const report = await deliverPendingPushes(provider, now);
  if (report.notifications > 0) {
    logger.info({ ...report, provider: provider.name }, "notifications.push : envoi terminé");
  }
  return report;
}
