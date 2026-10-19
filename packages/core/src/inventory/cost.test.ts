import { describe, expect, it } from "vitest";
import { computeWeightedAverageCost } from "./cost";
import { planMovement } from "./movement";

describe("computeWeightedAverageCost (RG-M07-05)", () => {
  it("exemple du PRD : 12 à 3 500 + 20 à 3 800 → 3 688", () => {
    expect(
      computeWeightedAverageCost({
        onHandQty: 12,
        averageCost: 3500,
        entryQty: 20,
        entryUnitCost: 3800,
      }),
    ).toBe(3688);
  });

  it("première réception (Q = 0) → CMP = coût d'entrée", () => {
    expect(
      computeWeightedAverageCost({
        onHandQty: 0,
        averageCost: 0,
        entryQty: 5,
        entryUnitCost: 4200,
      }),
    ).toBe(4200);
  });

  it("stock négatif (Q = −2) → Q⁺ = 0, CMP = coût d'entrée", () => {
    expect(
      computeWeightedAverageCost({
        onHandQty: -2,
        averageCost: 9000,
        entryQty: 10,
        entryUnitCost: 3000,
      }),
    ).toBe(3000);
  });

  it("arrondi demi-supérieur : 1 à 1 + 1 à 2 → 1,5 → 2", () => {
    expect(
      computeWeightedAverageCost({ onHandQty: 1, averageCost: 1, entryQty: 1, entryUnitCost: 2 }),
    ).toBe(2);
    // 2 à 1 + 1 à 2 → 1,333 → 1
    expect(
      computeWeightedAverageCost({ onHandQty: 2, averageCost: 1, entryQty: 1, entryUnitCost: 2 }),
    ).toBe(1);
  });

  it("unités fractionnaires : l'échelle se simplifie (4,5 L = 45 en base)", () => {
    // 10 L à 4 000 + 4,5 L à 5 000 → (40 000 + 22 500) / 14,5 = 4 310,34 → 4 310
    expect(
      computeWeightedAverageCost({
        onHandQty: 100,
        averageCost: 4000,
        entryQty: 45,
        entryUnitCost: 5000,
      }),
    ).toBe(4310);
  });

  it("grandes quantités sans dépassement de précision", () => {
    expect(
      computeWeightedAverageCost({
        onHandQty: 9_000_000_000,
        averageCost: 9_999_999,
        entryQty: 9_000_000_000,
        entryUnitCost: 10_000_000,
      }),
    ).toBe(10_000_000);
  });

  it("refuse une entrée nulle ou négative", () => {
    expect(() =>
      computeWeightedAverageCost({ onHandQty: 1, averageCost: 1, entryQty: 0, entryUnitCost: 1 }),
    ).toThrow();
  });
});

describe("planMovement (RG-M07-05/06)", () => {
  const base = { siteOnHand: 12, totalOnHand: 12, averageCost: 3500, allowNegative: false };

  it("réception : recalcule le CMP et le dernier prix d'achat", () => {
    const p = planMovement({ ...base, type: "PURCHASE_RECEIPT", quantity: 20, unitCost: 3800 });
    expect(p).toMatchObject({
      averageCostAfter: 3688,
      purchasePrice: 3800,
      siteOnHandAfter: 32,
      unitCost: 3800,
    });
  });

  it("sortie : CMP inchangé, valorisée au CMP courant", () => {
    const p = planMovement({
      ...base,
      averageCost: 3688,
      siteOnHand: 32,
      totalOnHand: 32,
      type: "ISSUE_TO_RO",
      quantity: -5,
    });
    expect(p).toMatchObject({ averageCostAfter: 3688, unitCost: 3688, siteOnHandAfter: 27 });
  });

  it("refuse une sortie supérieure au stock avec le détail par site", () => {
    expect(() =>
      planMovement({
        ...base,
        siteOnHand: 2,
        totalOnHand: 7,
        type: "ISSUE_TO_RO",
        quantity: -3,
        siteStocks: [
          { siteCode: "YOP", onHand: 2 },
          { siteCode: "COC", onHand: 5 },
        ],
      }),
    ).toThrow("Stock insuffisant : 2 disponibles à YOP, 5 disponibles à COC");
  });

  it("stock négatif autorisé : passe et signale le passage sous zéro", () => {
    const p = planMovement({
      ...base,
      siteOnHand: 1,
      totalOnHand: 1,
      allowNegative: true,
      type: "ISSUE_TO_RO",
      quantity: -3,
    });
    expect(p).toMatchObject({ siteOnHandAfter: -2, becameNegative: true, unitCost: 3500 });
  });

  it("réception sur stock négatif : CMP = coût d'entrée et régularisation", () => {
    const p = planMovement({
      ...base,
      siteOnHand: -2,
      totalOnHand: -2,
      type: "PURCHASE_RECEIPT",
      quantity: 10,
      unitCost: 3000,
    });
    expect(p).toMatchObject({ averageCostAfter: 3000, regularized: true });
  });

  it("ajustement positif au CMP courant : sans effet sur le CMP", () => {
    const p = planMovement({ ...base, type: "ADJUSTMENT", quantity: 3 });
    expect(p.averageCostAfter).toBe(3500);
  });

  it("retour fournisseur au coût d'origine sans modifier le CMP", () => {
    const p = planMovement({ ...base, type: "SUPPLIER_RETURN", quantity: -2, unitCost: 3200 });
    expect(p).toMatchObject({ unitCost: 3200, averageCostAfter: 3500 });
  });

  it("contrôle du signe et du coût obligatoire", () => {
    expect(() => planMovement({ ...base, type: "ISSUE_TO_RO", quantity: 2 })).toThrow();
    expect(() =>
      planMovement({ ...base, type: "PURCHASE_RECEIPT", quantity: -2, unitCost: 1 }),
    ).toThrow();
    expect(() => planMovement({ ...base, type: "PURCHASE_RECEIPT", quantity: 2 })).toThrow(
      "Le coût unitaire de l'entrée est obligatoire.",
    );
    expect(() => planMovement({ ...base, type: "ADJUSTMENT", quantity: 0 })).toThrow();
  });
});
