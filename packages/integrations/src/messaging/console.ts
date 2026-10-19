import type {
  Channel,
  HealthStatus,
  MessagingProvider,
  OutboundMessage,
  ProviderEvent,
  SendResult,
} from "./provider";

export interface OutboxEntry extends OutboundMessage {
  providerMessageId: string;
  sentAt: Date;
}

/** Journal en mémoire des envois "console", lu par la page /dev/outbox. */
export interface Outbox {
  push(entry: OutboxEntry): void;
  all(): readonly OutboxEntry[];
}

export function createInMemoryOutbox(): Outbox {
  const entries: OutboxEntry[] = [];
  return {
    push(entry) {
      entries.push(entry);
    },
    all() {
      return entries;
    },
  };
}

/**
 * Fournisseur de messagerie "console" : n'envoie jamais rien à un vrai opérateur. Les
 * messages sont journalisés (stdout + outbox injecté) pour que l'app tourne en local et en
 * tests sans compte WhatsApp/SMS/email réel (CLAUDE.md « Fournisseurs externes »).
 */
export class ConsoleMessagingProvider implements MessagingProvider {
  constructor(
    readonly channel: Channel,
    private readonly outbox: Outbox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    const providerMessageId = `console_${msg.idempotencyKey}`;
    const entry = { ...msg, providerMessageId, sentAt: this.now() };
    this.outbox.push(entry);
    console.log(`[outbox:${msg.channel}] → ${msg.to} : ${msg.body}`);
    return { providerMessageId };
  }

  async parseWebhook(_req: Request): Promise<ProviderEvent[]> {
    return [];
  }

  async verifyWebhook(_req: Request): Promise<boolean> {
    return true;
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, detail: "console" };
  }
}
