// PWA — notifications push (Web Push, VAPID). Le code applicatif ne parle qu'à cette
// interface : `web-push` en production (clés VAPID en variables d'environnement serveur),
// `console` en local et dans les tests (aucun compte ni clé requis).
import webpush from "web-push";

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body?: string | null;
  /** Page ouverte au toucher de la notification (chemin relatif à l'application). */
  link?: string | null;
  /** Regroupe les notifications du même objet sur l'appareil (une seule visible). */
  tag?: string;
}

export type PushSendResult =
  | { status: "sent" }
  /** Abonnement expiré ou révoqué (404/410) : à supprimer. */
  | { status: "gone" }
  | { status: "failed"; error: string };

export interface PushProvider {
  readonly name: "web_push" | "console";
  /** Clé publique VAPID transmise au navigateur pour s'abonner (null en mode console). */
  readonly publicKey: string | null;
  send(subscription: PushSubscriptionKeys, payload: PushPayload): Promise<PushSendResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` ou URL du site, exigé par les services de push. */
  subject: string;
}

export function createWebPushProvider(config: VapidConfig): PushProvider {
  return {
    name: "web_push",
    publicKey: config.publicKey,
    async send(subscription, payload) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify(payload),
          {
            TTL: 24 * 60 * 60,
            urgency: "normal",
            vapidDetails: {
              subject: config.subject,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
          },
        );
        return { status: "sent" };
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) return { status: "gone" };
        return { status: "failed", error: statusCode ? `HTTP ${statusCode}` : String(error) };
      }
    },
  };
}

export interface ConsolePushEntry {
  endpoint: string;
  payload: PushPayload;
  at: Date;
}

/** Boîte d'envoi en mémoire (local, tests) : rien ne quitte la machine. */
export class PushOutbox {
  readonly entries: ConsolePushEntry[] = [];
  record(entry: ConsolePushEntry) {
    this.entries.push(entry);
    if (this.entries.length > 200) this.entries.shift();
  }
  clear() {
    this.entries.length = 0;
  }
}

export const defaultPushOutbox = new PushOutbox();

export function createConsolePushProvider(
  outbox: PushOutbox = defaultPushOutbox,
  now: () => Date = () => new Date(),
): PushProvider {
  return {
    name: "console",
    publicKey: null,
    async send(subscription, payload) {
      outbox.record({ endpoint: subscription.endpoint, payload, at: now() });
      return { status: "sent" };
    },
  };
}

/**
 * Fournisseur selon l'environnement : Web Push si les trois variables VAPID sont présentes,
 * sinon console. Ne lève jamais : une configuration incomplète retombe sur la console.
 */
export function pushProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): PushProvider {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (publicKey && privateKey && subject) {
    return createWebPushProvider({ publicKey, privateKey, subject });
  }
  return createConsolePushProvider();
}
