import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../encryption";
import { createInMemoryManualPaymentLedger } from "../payment/manual";
import type { PaymentConfigRecord, PaymentConfigStore } from "./types";
import { resolvePaymentProvider } from "./payment";

const key = randomBytes(32);

function storeWith(record: PaymentConfigRecord | undefined): PaymentConfigStore {
  return {
    async getActive() {
      return record;
    },
  };
}

describe("resolvePaymentProvider", () => {
  it("renvoie le fournisseur manuel quand aucune configuration n'est active", async () => {
    const provider = await resolvePaymentProvider("org_1", {
      store: storeWith(undefined),
      encryptionKey: key,
      appUrl: "http://localhost:3000",
      ledger: createInMemoryManualPaymentLedger(),
    });

    const link = await provider.createPaymentLink({
      invoiceId: "inv_1",
      amount: 1000,
      customer: { name: "Test" },
      expiresAt: new Date(),
    });
    expect(link.url).toContain("/paiement-manuel/");
  });

  it("lève une erreur explicite pour un fournisseur réel pas encore implémenté", async () => {
    await expect(
      resolvePaymentProvider("org_1", {
        store: storeWith({
          provider: "wave",
          isActive: true,
          credentials: encryptSecret(JSON.stringify({ apiKey: "x" }), key),
        }),
        encryptionKey: key,
        appUrl: "http://localhost:3000",
        ledger: createInMemoryManualPaymentLedger(),
      }),
    ).rejects.toThrow(/wave.*pas encore implémenté/);
  });
});
