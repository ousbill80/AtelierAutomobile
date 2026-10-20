// M13 §9 — webhooks sortants : diffusion des événements métier vers les points de terminaison
// abonnés (`fanoutWebhookEvents`), puis une tentative pour chaque livraison échue
// (`deliverDueWebhooks`, reprises 1 min → 24 h, désactivation après 50 échecs). Transport
// `http` en production, simulateur ailleurs (WEBHOOK_SENDER) ; secret déchiffré à la volée.
import { activeWebhookSecrets, systemClock, type Clock } from "@atelieros/core";
import {
  deliverDueWebhooks,
  fanoutWebhookEvents,
  purgeApiState,
  type WebhookDeliveryDeps,
} from "@atelieros/db";
import {
  decryptSecret,
  loadEncryptionKey,
  resolveWebhookSender,
  signWebhook,
} from "@atelieros/integrations";
import { logger } from "../logger";

export function defaultWebhookDeps(): WebhookDeliveryDeps {
  return {
    transport: resolveWebhookSender(),
    secretsOf: (encrypted, now) =>
      activeWebhookSecrets(
        JSON.parse(decryptSecret(encrypted, loadEncryptionKey())) as {
          current: string;
          previous?: string | null;
          previousUntil?: string | null;
        },
        now,
      ),
    sign: signWebhook,
  };
}

export async function processWebhooksDispatchJob(
  clock: Clock = systemClock,
  deps: WebhookDeliveryDeps = defaultWebhookDeps(),
  organizationId?: string,
) {
  const now = clock.now();
  const fanout = await fanoutWebhookEvents(now, organizationId);
  const delivered = await deliverDueWebhooks(deps, now, organizationId);
  logger.info({ ...fanout, ...delivered }, "webhooks.dispatch");
  return { ...fanout, ...delivered };
}

export async function processIdempotencyPurgeJob(clock: Clock = systemClock) {
  const result = await purgeApiState(clock.now());
  logger.info(result, "idempotency.purge");
  return result;
}
