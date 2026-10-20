import { describe, expect, it } from "vitest";
import { createInMemoryManualPaymentLedger, ManualPaymentProvider } from "./manual";

describe("ManualPaymentProvider", () => {
  it("crée un lien vers l'écran de confirmation manuelle et initialise le statut à PENDING", async () => {
    const provider = new ManualPaymentProvider(
      "http://localhost:3000",
      createInMemoryManualPaymentLedger(),
    );

    const result = await provider.createPaymentLink({
      invoiceId: "inv_1",
      amount: 36580,
      customer: { name: "Kouassi Jean-Marc" },
      expiresAt: new Date("2026-02-01T00:00:00Z"),
    });

    expect(result).toEqual({
      url: "http://localhost:3000/paiement-manuel/manual_inv_1",
      providerRef: "manual_inv_1",
    });
    await expect(provider.getStatus("manual_inv_1")).resolves.toMatchObject({ status: "PENDING" });
  });

  it("reflète le statut mis à jour par le caissier dans le grand livre injecté", async () => {
    const ledger = createInMemoryManualPaymentLedger();
    const provider = new ManualPaymentProvider("http://localhost:3000", ledger);
    await provider.createPaymentLink({
      invoiceId: "inv_2",
      amount: 10000,
      customer: { name: "Bamba Aminata" },
      expiresAt: new Date("2026-02-01T00:00:00Z"),
    });

    ledger.save({ providerRef: "manual_inv_2", status: "PAID" });

    await expect(provider.getStatus("manual_inv_2")).resolves.toMatchObject({ status: "PAID" });
  });

  it("n'accepte aucun webhook : la confirmation passe par la caisse, pas par un fournisseur", async () => {
    const provider = new ManualPaymentProvider(
      "http://localhost:3000",
      createInMemoryManualPaymentLedger(),
    );
    expect(provider.verifyWebhook()).toBe(false);
    expect(() => provider.parseWebhook()).toThrow(/webhook/);
  });

  it("renvoie PENDING pour une référence inconnue plutôt que de lever une erreur", async () => {
    const provider = new ManualPaymentProvider(
      "http://localhost:3000",
      createInMemoryManualPaymentLedger(),
    );
    await expect(provider.getStatus("manual_inconnu")).resolves.toMatchObject({
      status: "PENDING",
    });
  });
});
