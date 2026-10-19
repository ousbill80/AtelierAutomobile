import { describe, expect, it } from "vitest";
import { ManualFneProvider } from "./manual";

describe("ManualFneProvider", () => {
  it("refuse toute certification programmatique plutôt que de fabriquer un faux numéro FNE", async () => {
    const provider = new ManualFneProvider();

    await expect(
      provider.certify({
        invoiceId: "inv_1",
        number: "FAC-2026-000123",
        issuedAt: new Date("2026-01-01T00:00:00Z"),
        totalTtc: 128981,
        totalVat: 19676,
        customer: { name: "Kouassi Jean-Marc" },
      }),
    ).rejects.toThrow(/manuel/);
  });
});
