import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptSecret } from "../encryption";
import { CinetPayProvider } from "../payment/cinetpay";
import { createInMemorySimulatorLedger, FakePaymentProvider } from "../payment/fake";
import { createInMemoryManualPaymentLedger } from "../payment/manual";
import { WaveProvider } from "../payment/wave";
import type { PaymentConfigRecord, PaymentConfigStore } from "./types";
import { buildPaymentProvider, resolvePaymentProvider } from "./payment";

const key = randomBytes(32);
const deps = {
  encryptionKey: key,
  appUrl: "http://localhost:3000",
  ledger: createInMemoryManualPaymentLedger(),
  simulatorLedger: createInMemorySimulatorLedger(),
};

function storeWith(record: PaymentConfigRecord | undefined): PaymentConfigStore {
  return {
    async getActive() {
      return record;
    },
  };
}

const config = (provider: string, credentials: Record<string, string>): PaymentConfigRecord => ({
  provider,
  isActive: true,
  credentials: encryptSecret(JSON.stringify(credentials), key),
});

describe("resolvePaymentProvider", () => {
  it("renvoie le fournisseur manuel quand aucune configuration n'est active", async () => {
    const provider = await resolvePaymentProvider("org_1", {
      ...deps,
      store: storeWith(undefined),
    });
    const link = await provider.createPaymentLink({
      invoiceId: "inv_1",
      amount: 1000,
      customer: { name: "Test" },
      expiresAt: new Date(),
    });
    expect(link.url).toContain("/paiement-manuel/");
  });

  it("construit CinetPay, Wave et le simulateur à partir des identifiants chiffrés", async () => {
    const cinetpay = config("cinetpay", { apiKey: "k", siteId: "s", secretKey: "x" });
    expect(
      await resolvePaymentProvider("org_1", { ...deps, store: storeWith(cinetpay) }),
    ).toBeInstanceOf(CinetPayProvider);
    expect(
      buildPaymentProvider(config("wave", { apiKey: "k", webhookSecret: "w" }), deps),
    ).toBeInstanceOf(WaveProvider);
    expect(buildPaymentProvider(config("fake", { webhookSecret: "w" }), deps)).toBeInstanceOf(
      FakePaymentProvider,
    );
  });

  it("refuse le simulateur en production, un fournisseur inconnu et des identifiants incomplets", () => {
    expect(() =>
      buildPaymentProvider(config("fake", { webhookSecret: "w" }), {
        ...deps,
        allowSimulator: false,
      }),
    ).toThrow(/interdit en production/);
    expect(() => buildPaymentProvider(config("paypal", {}), deps)).toThrow(/inconnu/);
    expect(() => buildPaymentProvider(config("wave", { apiKey: "secret-k" }), deps)).toThrow(
      /incomplets/,
    );
    try {
      buildPaymentProvider(config("wave", { apiKey: "secret-k" }), deps);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("secret-k");
    }
  });

  it("identifiants chiffrés avec une autre clé : erreur lisible", () => {
    const other = {
      provider: "wave",
      isActive: true,
      credentials: encryptSecret("{}", randomBytes(32)),
    };
    expect(() => buildPaymentProvider(other, deps)).toThrow(/illisibles/);
  });
});
