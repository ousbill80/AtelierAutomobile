import { describe, expect, it } from "vitest";
import { createConsolePushProvider, PushOutbox, pushProviderFromEnv } from "./provider";

describe("push providers", () => {
  it("console : enregistre la notification sans rien envoyer", async () => {
    const outbox = new PushOutbox();
    const at = new Date("2026-11-02T08:00:00Z");
    const provider = createConsolePushProvider(outbox, () => at);
    const result = await provider.send(
      { endpoint: "https://push.example/abc", p256dh: "k", auth: "a" },
      { title: "Facture impayée", body: "SOTRA doit 450 000 FCFA", link: "/creances" },
    );
    expect(result).toEqual({ status: "sent" });
    expect(outbox.entries).toEqual([
      {
        endpoint: "https://push.example/abc",
        payload: { title: "Facture impayée", body: "SOTRA doit 450 000 FCFA", link: "/creances" },
        at,
      },
    ]);
    expect(provider.publicKey).toBeNull();
  });

  it("choisit Web Push seulement si les trois variables VAPID sont présentes", () => {
    expect(pushProviderFromEnv({}).name).toBe("console");
    expect(pushProviderFromEnv({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "" }).name).toBe(
      "console",
    );
    const provider = pushProviderFromEnv({
      VAPID_PUBLIC_KEY: "pub",
      VAPID_PRIVATE_KEY: "priv",
      VAPID_SUBJECT: "mailto:contact@example.com",
    });
    expect(provider.name).toBe("web_push");
    expect(provider.publicKey).toBe("pub");
  });
});
