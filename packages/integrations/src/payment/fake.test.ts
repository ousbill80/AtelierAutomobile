import { describe, expect, it } from "vitest";
import {
  createInMemorySimulatorLedger,
  FakePaymentProvider,
  SIMULATOR_SIGNATURE_HEADER,
} from "./fake";

const now = new Date("2026-10-20T10:00:00Z");

function provider(secret = "whsec_test") {
  return new FakePaymentProvider({
    appUrl: "http://localhost:3000",
    webhookSecret: secret,
    ledger: createInMemorySimulatorLedger(),
  });
}

const input = {
  invoiceId: "inv_1",
  reference: "FAC-2026-000412",
  amount: 85_000,
  customer: { name: "Kouassi" },
  expiresAt: now,
  returnUrl: "http://localhost:3000/p/tok/facture",
  notifyUrl: "http://localhost:3000/api/webhooks/payments/fake/org_1",
};

describe("FakePaymentProvider (simulateur)", () => {
  it("lien vers la page de paiement simulé, statut en attente", async () => {
    const p = provider();
    const link = await p.createPaymentLink(input);
    expect(link.url).toBe(`http://localhost:3000/p/paiement-simule/${link.providerRef}`);
    expect(link.providerRef).toMatch(/^sim_/);
    expect(await p.getStatus(link.providerRef)).toMatchObject({ status: "PENDING", amount: null });
    expect(p.describe(link.providerRef)).toMatchObject({
      amount: 85_000,
      returnUrl: input.returnUrl,
    });
  });

  it("paiement simulé : webhook signé, statut et montant confirmés par getStatus", async () => {
    const p = provider();
    const { providerRef } = await p.createPaymentLink(input);
    const hook = p.simulate(providerRef, { status: "PAID", payerPhone: "+2250747218890" }, now)!;
    expect(hook.notifyUrl).toBe(input.notifyUrl);
    const headers = new Headers(hook.headers);
    expect(p.verifyWebhook(hook.rawBody, headers)).toBe(true);
    expect(p.parseWebhook(hook.rawBody)).toMatchObject({
      providerRef,
      status: "PAID",
      amount: 85_000,
    });
    expect(await p.getStatus(providerRef)).toEqual({
      status: "PAID",
      amount: 85_000,
      method: "WAVE",
      paidAt: now,
      payerPhone: "+2250747218890",
    });
    // Rejouer un paiement déjà traité ne produit rien.
    expect(p.simulate(providerRef, { status: "PAID" }, now)).toBeNull();
  });

  it("signature invalide, absente ou d'un autre secret : refusée", async () => {
    const p = provider();
    const { providerRef } = await p.createPaymentLink(input);
    const hook = p.simulate(providerRef, { status: "PAID", amount: 80_000 }, now)!;
    expect(p.verifyWebhook(hook.rawBody + " ", new Headers(hook.headers))).toBe(false);
    expect(p.verifyWebhook(hook.rawBody, new Headers())).toBe(false);
    expect(provider("autre").verifyWebhook(hook.rawBody, new Headers(hook.headers))).toBe(false);
    const forged = new Headers({ [SIMULATOR_SIGNATURE_HEADER]: "00" });
    expect(p.verifyWebhook(hook.rawBody, forged)).toBe(false);
  });

  it("échec simulé : statut FAILED, sans montant", async () => {
    const p = provider();
    const { providerRef } = await p.createPaymentLink(input);
    p.simulate(providerRef, { status: "FAILED" }, now);
    expect(await p.getStatus(providerRef)).toMatchObject({ status: "FAILED", amount: null });
  });
});
