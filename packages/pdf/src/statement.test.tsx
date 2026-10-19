import { describe, expect, it } from "vitest";
import { renderStatementPdf } from "./statement";

describe("renderStatementPdf (RG-M09-15)", () => {
  it("produit un PDF non vide", async () => {
    const buffer = await renderStatementPdf({
      garage: {
        name: "Garage Test",
        address: "Abidjan, Cocody",
        rccm: "CI-ABJ-2020-B-1",
        ncc: "1234567A",
      },
      customer: { displayName: "SOTRA Logistique SARL", ncc: "7654321B" },
      from: "2026-01-01",
      to: "2026-10-18",
      openingBalance: 0,
      closingBalance: 1_240_000,
      totalDebit: 1_240_000,
      totalCredit: 0,
      lines: [
        {
          date: "2026-08-27",
          reference: "FAC-2026-000350",
          label: "Facture",
          debit: 640_000,
          credit: 0,
          runningBalance: 640_000,
        },
        {
          date: "2026-09-10",
          reference: "FAC-2026-000388",
          label: "Facture",
          debit: 600_000,
          credit: 0,
          runningBalance: 1_240_000,
        },
      ],
      aging: { notDue: 0, buckets: { b0_30: 200_000, b31_60: 1_040_000, b61_90: 0, b90p: 0 } },
      openInvoices: [
        {
          number: "FAC-2026-000350",
          fneNumber: "FNE-1",
          dueDate: "2026-08-27",
          total: 640_000,
          balance: 640_000,
          daysOverdue: 52,
        },
      ],
    });
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  }, 30_000);
});
