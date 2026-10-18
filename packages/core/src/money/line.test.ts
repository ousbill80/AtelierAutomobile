import { describe, expect, it } from "vitest";
import { computeInvoiceTotals, computeLine, ttcToHt } from "./line";

describe("computeLine — RG-M08-05", () => {
  it("ligne sans remise ni TVA désactivée", () => {
    expect(computeLine({ quantity: 1, unitPrice: 15000, vatRate: 18 })).toEqual({
      gross: 15000,
      lineSubtotal: 15000,
      lineVat: 2700,
      lineTotal: 17700,
    });
  });

  it("arrondit la TVA au plus proche, demi vers le haut (huile 4,5 L)", () => {
    expect(computeLine({ quantity: 4.5, unitPrice: 6350, vatRate: 18 })).toEqual({
      gross: 28575,
      lineSubtotal: 28575,
      lineVat: 5144,
      lineTotal: 33719,
    });
  });

  it("applique la remise en pourcentage avant la TVA (filtre à huile, remise 10 %)", () => {
    expect(computeLine({ quantity: 1, unitPrice: 4750, discountRate: 10, vatRate: 18 })).toEqual({
      gross: 4750,
      lineSubtotal: 4275,
      lineVat: 770,
      lineTotal: 5045,
    });
  });

  it("remise 5 % sur plaquettes AV", () => {
    expect(computeLine({ quantity: 1, unitPrice: 37900, discountRate: 5, vatRate: 18 })).toEqual({
      gross: 37900,
      lineSubtotal: 36005,
      lineVat: 6481,
      lineTotal: 42486,
    });
  });

  it("quantité décimale 1,5 h de main-d'œuvre", () => {
    expect(computeLine({ quantity: 1.5, unitPrice: 15000, vatRate: 18 })).toEqual({
      gross: 22500,
      lineSubtotal: 22500,
      lineVat: 4050,
      lineTotal: 26550,
    });
  });

  it("RG-M08-08 — vatEnabled=false force lineVat à 0 même avec un vatRate renseigné", () => {
    const line = computeLine({ quantity: 1, unitPrice: 10000, vatRate: 18, vatEnabled: false });
    expect(line.lineVat).toBe(0);
    expect(line.lineTotal).toBe(line.lineSubtotal);
  });

  it("RG-M08-12 — avoir : quantité négative produit des montants négatifs", () => {
    expect(computeLine({ quantity: -1, unitPrice: 15000, vatRate: 18 })).toEqual({
      gross: -15000,
      lineSubtotal: -15000,
      lineVat: -2700,
      lineTotal: -17700,
    });
  });

  it("refuse une remise hors de [0, 100]", () => {
    expect(() =>
      computeLine({ quantity: 1, unitPrice: 1000, discountRate: 101, vatRate: 18 }),
    ).toThrow(/remise/);
    expect(() =>
      computeLine({ quantity: 1, unitPrice: 1000, discountRate: -1, vatRate: 18 }),
    ).toThrow(/remise/);
  });

  it("refuse un taux de TVA négatif", () => {
    expect(() => computeLine({ quantity: 1, unitPrice: 1000, vatRate: -5 })).toThrow(/TVA/);
  });
});

describe("computeInvoiceTotals — RG-M08-06 (exemple chiffré)", () => {
  it("reproduit exactement les totaux publiés : HT net 109 305, TVA 19 676, TTC 128 981", () => {
    const lines = [
      computeLine({ quantity: 1, unitPrice: 15000, vatRate: 18 }), // MO vidange
      computeLine({ quantity: 4.5, unitPrice: 6350, vatRate: 18 }), // Huile
      computeLine({ quantity: 1, unitPrice: 4750, discountRate: 10, vatRate: 18 }), // Filtre
      computeLine({ quantity: 1, unitPrice: 37900, discountRate: 5, vatRate: 18 }), // Plaquettes AV
      computeLine({ quantity: 1.5, unitPrice: 15000, vatRate: 18 }), // MO plaquettes
      computeLine({ quantity: 0.5, unitPrice: 5900, vatRate: 18 }), // Liquide de frein
    ];

    const totals = computeInvoiceTotals(lines);

    expect(totals.subtotal).toBe(109305);
    expect(totals.vatTotal).toBe(19676);
    expect(totals.total).toBe(128981);
    expect(totals.grossSubtotal).toBe(111675);
    expect(totals.discountTotal).toBe(2370);
  });

  it("totaux à zéro pour une liste de lignes vide", () => {
    expect(computeInvoiceTotals([])).toEqual({
      grossSubtotal: 0,
      discountTotal: 0,
      subtotal: 0,
      vatTotal: 0,
      total: 0,
    });
  });
});

describe("ttcToHt — RG-M08-07", () => {
  it("déduit HT et TVA d'un acompte TTC (50 000 TTC, 18 %)", () => {
    expect(ttcToHt(50000, 18)).toEqual({ ht: 42373, vat: 7627 });
  });

  it("TVA nulle quand le taux est 0", () => {
    expect(ttcToHt(50000, 0)).toEqual({ ht: 50000, vat: 0 });
  });

  it("refuse un taux négatif", () => {
    expect(() => ttcToHt(50000, -1)).toThrow(/TVA/);
  });
});
