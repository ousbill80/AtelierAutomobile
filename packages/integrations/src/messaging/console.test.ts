import { describe, expect, it } from "vitest";
import { ConsoleMessagingProvider, createInMemoryOutbox } from "./console";
import type { OutboundMessage } from "./provider";

const baseMessage: OutboundMessage = {
  organizationId: "org_1",
  to: "+2250747218890",
  channel: "WHATSAPP",
  template: "raw",
  body: "Bonjour M. Kouassi",
  idempotencyKey: "reminder_42",
};

describe("ConsoleMessagingProvider", () => {
  it("journalise le message dans l'outbox et renvoie un providerMessageId stable", async () => {
    const outbox = createInMemoryOutbox();
    const provider = new ConsoleMessagingProvider(
      "WHATSAPP",
      outbox,
      () => new Date("2026-01-01T00:00:00Z"),
    );

    const result = await provider.send(baseMessage);

    expect(result.providerMessageId).toBe("console_reminder_42");
    expect(outbox.all()).toEqual([
      {
        ...baseMessage,
        providerMessageId: "console_reminder_42",
        sentAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });

  it("n'envoie jamais rien à un vrai opérateur : verifyWebhook et healthCheck sont toujours positifs", async () => {
    const provider = new ConsoleMessagingProvider("SMS", createInMemoryOutbox());

    await expect(provider.verifyWebhook({} as Request)).resolves.toBe(true);
    await expect(provider.parseWebhook({} as Request)).resolves.toEqual([]);
    await expect(provider.healthCheck()).resolves.toEqual({ ok: true, detail: "console" });
  });
});
