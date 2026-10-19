import { describe, expect, it } from "vitest";
import { createConsoleMessagingProvider, MessagingOutbox } from "./console";

describe("createConsoleMessagingProvider", () => {
  it("journalise le message envoyé dans l'outbox fournie", async () => {
    const outbox = new MessagingOutbox();
    const provider = createConsoleMessagingProvider("WHATSAPP", outbox);

    const result = await provider.send({
      to: "+2250708123456",
      channel: "WHATSAPP",
      body: "AtelierOS : votre code est 482913. Il expire dans 5 minutes.",
    });

    expect(result.providerMessageId).toMatch(/^console_whatsapp_/);
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.list()[0]).toMatchObject({
      to: "+2250708123456",
      channel: "WHATSAPP",
    });
  });

  it("lastFor renvoie le message le plus récent pour un destinataire", async () => {
    const outbox = new MessagingOutbox();
    const provider = createConsoleMessagingProvider("SMS", outbox);

    await provider.send({ to: "+2250708123456", channel: "SMS", body: "premier" });
    await provider.send({ to: "+2250708123456", channel: "SMS", body: "second" });
    await provider.send({ to: "+2250000000000", channel: "SMS", body: "autre destinataire" });

    expect(outbox.lastFor("+2250708123456")?.body).toBe("second");
  });

  it("verifyWebhook et healthCheck renvoient des réponses triviales", async () => {
    const provider = createConsoleMessagingProvider("EMAIL", new MessagingOutbox());
    const req = new Request("http://localhost/webhook");
    expect(await provider.verifyWebhook(req)).toBe(true);
    expect(await provider.parseWebhook(req)).toEqual([]);
    expect(await provider.healthCheck()).toEqual({ ok: true, detail: expect.any(String) });
  });

  it("clear() vide l'outbox", async () => {
    const outbox = new MessagingOutbox();
    const provider = createConsoleMessagingProvider("SMS", outbox);
    await provider.send({ to: "+2250708123456", channel: "SMS", body: "x" });
    outbox.clear();
    expect(outbox.list()).toHaveLength(0);
  });
});
