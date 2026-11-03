import { describe, expect, it } from "vitest";
import { emptyPulseLevel, summarizeGaragePulse, type PulseLevel } from "./pulse";
import { garageStarterCatalog } from "./starterCatalog";

const now = new Date("2026-10-28T12:00:00.000Z");

function level(patch: Partial<PulseLevel> & Pick<PulseLevel, "productId">): PulseLevel {
  return {
    onHand: 0,
    reserved: 0,
    minStock: 0,
    quantityScale: 1,
    averageCost: 0,
    isStocked: true,
    ...patch,
  };
}

describe("summarizeGaragePulse", () => {
  it("un magasin vide ne signale rien", () => {
    expect(summarizeGaragePulse({ levels: [], purchases: [], now })).toEqual({
      products: 0,
      belowMin: 0,
      outOfStock: 0,
      negative: 0,
      stockValue: 0,
      drafts: 0,
      toReceive: 0,
      late: 0,
    });
  });

  it("une pièce sans stock et sous le mini est une rupture à commander", () => {
    const pulse = summarizeGaragePulse({
      levels: [level({ productId: "filtre", minStock: 8 })],
      purchases: [],
      now,
    });
    expect(pulse).toMatchObject({ products: 1, belowMin: 1, outOfStock: 1, stockValue: 0 });
  });

  it("le disponible d'un site couvre le garage : pas de rupture, valeur au CMP", () => {
    const pulse = summarizeGaragePulse({
      levels: [
        level({
          productId: "huile",
          onHand: 0,
          minStock: 20,
          quantityScale: 10,
          averageCost: 3800,
        }),
        level({
          productId: "huile",
          onHand: 45,
          minStock: 20,
          quantityScale: 10,
          averageCost: 3800,
        }),
      ],
      purchases: [],
      now,
    });
    // 4,5 L × 3 800 = 17 100. Un site à zéro sous le mini, l'autre en stock.
    expect(pulse).toMatchObject({
      products: 1,
      belowMin: 1,
      outOfStock: 0,
      negative: 0,
      stockValue: 17100,
    });
  });

  it("un stock négatif est à régulariser et ne compte pas dans la valeur", () => {
    const pulse = summarizeGaragePulse({
      levels: [level({ productId: "plaquette", onHand: -2, minStock: 4, averageCost: 14000 })],
      purchases: [],
      now,
    });
    expect(pulse).toMatchObject({ negative: 1, outOfStock: 0, stockValue: 0, belowMin: 1 });
  });

  it("une pièce non stockée (commande à la demande) ne crée pas d'alerte", () => {
    const pulse = summarizeGaragePulse({
      levels: [level({ productId: "turbo", isStocked: false, minStock: 1 })],
      purchases: [],
      now,
    });
    expect(pulse).toMatchObject({ products: 1, belowMin: 0, outOfStock: 0 });
  });

  it("compte les brouillons, les réceptions en attente et les retards", () => {
    const pulse = summarizeGaragePulse({
      levels: [],
      purchases: [
        { status: "DRAFT", expectedAt: new Date("2026-10-01T00:00:00.000Z") },
        { status: "SENT", expectedAt: new Date("2026-10-20T00:00:00.000Z") },
        { status: "PARTIALLY_RECEIVED", expectedAt: new Date("2026-11-02T00:00:00.000Z") },
        { status: "RECEIVED", expectedAt: new Date("2026-10-01T00:00:00.000Z") },
      ],
      now,
    });
    expect(pulse).toMatchObject({ drafts: 1, toReceive: 2, late: 1 });
  });
});

describe("emptyPulseLevel", () => {
  it("ramène le mini du produit en unités de base", () => {
    expect(
      emptyPulseLevel({
        id: "huile",
        isStocked: true,
        minStock: 20,
        quantityScale: 10,
        averageCost: 3800,
      }),
    ).toMatchObject({ productId: "huile", onHand: 0, minStock: 200, quantityScale: 10 });
  });
});

describe("garageStarterCatalog", () => {
  it("propose des pièces courantes, prix entiers, achat sous le prix de vente", () => {
    const catalog = garageStarterCatalog();
    const skus = catalog.map((item) => item.sku);
    expect(new Set(skus).size).toBe(skus.length);
    expect(catalog.length).toBeGreaterThanOrEqual(12);
    for (const item of catalog) {
      expect(Number.isInteger(item.salePrice)).toBe(true);
      expect(Number.isInteger(item.purchasePrice)).toBe(true);
      expect(item.purchasePrice).toBeGreaterThan(0);
      expect(item.purchasePrice).toBeLessThan(item.salePrice);
      expect(item.minStock).toBeGreaterThan(0);
      expect(item.reorderQty).toBeGreaterThan(0);
      expect(item.packSize).toBeGreaterThan(0);
    }
    expect(catalog.find((item) => item.unit === "litre")?.sku).toBe("HUILE-5W30");
  });
});
