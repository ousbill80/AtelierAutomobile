import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./report";

describe("renderReportPdf (M12 §7)", () => {
  it("produit un PDF A4 paysage non vide avec totaux", async () => {
    const buffer = await renderReportPdf({
      garage: { name: "Garage Excellence Auto", ncc: "1234567A" },
      title: "Balance âgée",
      params: ["Situation au 30/09/2026", "Site : Réseau"],
      columns: [
        { key: "customer", label: "Client", numeric: false },
        { key: "balance", label: "Solde", numeric: true },
      ],
      rows: [{ customer: "SOTRA Logistique", balance: "1 240 000 FCFA" }],
      totals: { balance: "1 240 000 FCFA" },
      totalLabel: "Total",
      notes: [],
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
