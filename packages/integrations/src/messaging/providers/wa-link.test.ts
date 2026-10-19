import { describe, expect, it } from "vitest";
import { isDomainError } from "@atelieros/core";
import { createWaLinkProvider } from "./wa-link";

describe("createWaLinkProvider", () => {
  it("refuse l'envoi automatique", async () => {
    const provider = createWaLinkProvider();
    await expect(
      provider.send({ to: "+2250747218890", channel: "WHATSAPP", body: "x", idempotencyKey: "k" }),
    ).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "messaging.wa_link_manual_only",
    );
  });

  it("n'a pas de webhook mais répond disponible au health check", async () => {
    const provider = createWaLinkProvider();
    const dummyRequest = new Request("http://localhost/api/webhooks/whatsapp");
    expect(await provider.parseWebhook(dummyRequest)).toEqual([]);
    expect(await provider.verifyWebhook(dummyRequest)).toBe(true);
    expect((await provider.healthCheck()).ok).toBe(true);
  });
});
