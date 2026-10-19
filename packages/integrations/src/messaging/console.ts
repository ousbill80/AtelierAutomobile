import type {
  HealthStatus,
  MessageChannel,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "./types";

export interface OutboxEntry extends OutboundMessage {
  id: string;
  sentAt: Date;
}

/**
 * Journal en mémoire des messages envoyés par les fournisseurs `console`, consultable
 * via `/dev/outbox` (M01 E2E : lecture des OTP sans compte WhatsApp/SMS réel).
 */
export class MessagingOutbox {
  private entries: OutboxEntry[] = [];

  push(entry: OutboxEntry): void {
    this.entries.push(entry);
  }

  list(): readonly OutboxEntry[] {
    return this.entries;
  }

  /** Dernier message envoyé à ce destinataire, tous canaux confondus, le plus récent en premier. */
  lastFor(to: string): OutboxEntry | undefined {
    return [...this.entries].reverse().find((entry) => entry.to === to);
  }

  clear(): void {
    this.entries = [];
  }
}

/** Partagé par défaut entre les providers `console` d'un même processus (dev/tests). */
export const defaultOutbox = new MessagingOutbox();

/**
 * Fournisseur de développement/tests : n'appelle aucun service externe, journalise
 * le message dans la console et dans un outbox consultable (`/dev/outbox`).
 */
export function createConsoleMessagingProvider(
  channel: MessageChannel,
  outbox: MessagingOutbox = defaultOutbox,
): MessagingProvider {
  return {
    channel,
    async send(msg: OutboundMessage): Promise<SendResult> {
      const providerMessageId = `console_${channel.toLowerCase()}_${crypto.randomUUID()}`;
      outbox.push({ ...msg, id: providerMessageId, sentAt: new Date() });
      console.log(`[messaging:console:${channel}] → ${msg.to} : ${msg.body}`);
      return { providerMessageId };
    },
    async parseWebhook(): Promise<ProviderEvent[]> {
      return [];
    },
    async verifyWebhook(): Promise<boolean> {
      return true;
    },
    async healthCheck(): Promise<HealthStatus> {
      return { ok: true, detail: "console (développement/tests)" };
    },
  };
}
