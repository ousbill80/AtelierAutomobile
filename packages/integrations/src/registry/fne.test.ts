import { describe, expect, it } from "vitest";
import type { FneConfigRecord, FneConfigStore } from "./types";
import { resolveFneProvider } from "./fne";

function storeWith(record: FneConfigRecord | undefined): FneConfigStore {
  return {
    async get() {
      return record;
    },
  };
}

describe("resolveFneProvider", () => {
  it("renvoie le fournisseur manuel quand aucune configuration n'existe", async () => {
    const provider = await resolveFneProvider("org_1", storeWith(undefined));
    await expect(
      provider.certify({
        invoiceId: "inv_1",
        number: "FAC-2026-000001",
        issuedAt: new Date(),
        totalTtc: 1000,
        totalVat: 100,
        customer: { name: "Test" },
      }),
    ).rejects.toThrow(/manuel/);
  });

  it("renvoie le fournisseur manuel en mode 'manual' ou 'disabled'", async () => {
    await expect(
      resolveFneProvider("org_1", storeWith({ mode: "manual", isActive: true, credentials: null })),
    ).resolves.toBeInstanceOf(Object);
    await expect(
      resolveFneProvider(
        "org_1",
        storeWith({ mode: "disabled", isActive: false, credentials: null }),
      ),
    ).resolves.toBeInstanceOf(Object);
  });

  it("lève une erreur explicite en mode 'api' tant que la spécification DGI n'est pas branchée", async () => {
    await expect(
      resolveFneProvider(
        "org_1",
        storeWith({ mode: "api", isActive: true, credentials: "chiffré" }),
      ),
    ).rejects.toThrow(/DGI/);
  });
});
