import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../encryption";
import { createInMemoryOutbox } from "../messaging/console";
import type { MessagingConfigRecord, MessagingConfigStore } from "./types";
import { resolveMessagingProvider } from "./messaging";

const key = randomBytes(32);

function storeWith(records: MessagingConfigRecord[]): MessagingConfigStore {
  return {
    async listActive(_organizationId, channel) {
      return records.filter((record) => record.channel === channel);
    },
  };
}

describe("resolveMessagingProvider", () => {
  it("renvoie le fournisseur console quand aucune configuration n'est active", async () => {
    const provider = await resolveMessagingProvider("org_1", "WHATSAPP", {
      store: storeWith([]),
      encryptionKey: key,
      outbox: createInMemoryOutbox(),
    });

    expect(provider.channel).toBe("WHATSAPP");
    await expect(provider.healthCheck()).resolves.toEqual({ ok: true, detail: "console" });
  });

  it("renvoie le fournisseur console quand la configuration active est explicitement 'console'", async () => {
    const provider = await resolveMessagingProvider("org_1", "SMS", {
      store: storeWith([
        {
          channel: "SMS",
          provider: "console",
          isActive: true,
          priority: 1,
          credentials: "{}",
          senderId: null,
        },
      ]),
      encryptionKey: key,
      outbox: createInMemoryOutbox(),
    });

    expect(provider.channel).toBe("SMS");
  });

  it("choisit la configuration de priorité la plus haute (nombre le plus bas)", async () => {
    await expect(
      resolveMessagingProvider("org_1", "SMS", {
        store: storeWith([
          {
            channel: "SMS",
            provider: "orange_sms",
            isActive: true,
            priority: 2,
            credentials: encryptSecret("{}", key),
            senderId: "ATELIEROS",
          },
          {
            channel: "SMS",
            provider: "console",
            isActive: true,
            priority: 1,
            credentials: "{}",
            senderId: null,
          },
        ]),
        encryptionKey: key,
        outbox: createInMemoryOutbox(),
      }),
    ).resolves.toMatchObject({ channel: "SMS" });
  });

  it("lève une erreur explicite pour un fournisseur réel pas encore implémenté", async () => {
    await expect(
      resolveMessagingProvider("org_1", "SMS", {
        store: storeWith([
          {
            channel: "SMS",
            provider: "orange_sms",
            isActive: true,
            priority: 1,
            credentials: encryptSecret(JSON.stringify({ apiKey: "x" }), key),
            senderId: "ATELIEROS",
          },
        ]),
        encryptionKey: key,
        outbox: createInMemoryOutbox(),
      }),
    ).rejects.toThrow(/orange_sms.*pas encore implémenté/);
  });
});
