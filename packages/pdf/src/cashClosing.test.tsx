import { describe, expect, it } from "vitest";
import { renderCashClosingPdf } from "./cashClosing";

describe("renderCashClosingPdf (M08 §7 — Z de caisse)", () => {
  it("produit un PDF non vide avec totaux, coupures, dépenses et validation", async () => {
    const buffer = await renderCashClosingPdf({
      garage: { name: "Garage Excellence Auto", ncc: "1234567A" },
      site: "Yopougon",
      openedAt: "19/10/2026 07:45",
      closedAt: "19/10/2026 18:30",
      openedBy: "Awa Koné",
      closedBy: "Awa Koné",
      lateClose: false,
      openingFloat: 50_000,
      byMethod: [
        { label: "Espèces", amount: 280_000 },
        { label: "Wave", amount: 85_000 },
      ],
      totalReceived: 365_000,
      pendingCheques: 120_000,
      cashPayments: 280_000,
      expensesTotal: 12_500,
      cashRefunds: 5_000,
      dropsTotal: 40_000,
      expectedCash: 272_500,
      countedCash: 270_000,
      difference: -2_500,
      notes: "Erreur de rendu",
      denominations: [{ value: 10_000, count: 27 }],
      expenses: [
        { time: "10:12", category: "Carburant", description: "Essai routier", amount: 12_500 },
      ],
      drops: [{ time: "15:00", destination: "Coffre", reference: "BV-12", amount: 40_000 }],
      counts: { payments: 4, expenses: 1, drops: 1, refunds: 1 },
      review: { by: "Kader N.", at: "20/10/2026 08:10", comment: "Écart accepté" },
      printedAt: "20/10/2026 08:15",
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("gère une session encore ouverte (pas de comptage ni d'écart)", async () => {
    const buffer = await renderCashClosingPdf({
      garage: { name: "Garage" },
      site: "Cocody",
      openedAt: "22/10/2026 08:00",
      closedAt: null,
      openedBy: "Bakary",
      closedBy: null,
      lateClose: false,
      openingFloat: 0,
      byMethod: [],
      totalReceived: 0,
      pendingCheques: 0,
      cashPayments: 0,
      expensesTotal: 0,
      cashRefunds: 0,
      dropsTotal: 0,
      expectedCash: 0,
      countedCash: null,
      difference: null,
      notes: null,
      denominations: [],
      expenses: [],
      drops: [],
      counts: { payments: 0, expenses: 0, drops: 0, refunds: 0 },
      review: null,
      printedAt: "22/10/2026 09:00",
    });
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
  });
});
