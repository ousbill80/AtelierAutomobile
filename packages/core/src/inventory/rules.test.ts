import { describe, expect, it } from "vitest";
import {
  allocateBackorders,
  isStaleReservation,
  planReservation,
  projectedAvailable,
} from "./availability";
import { formatCompatibility, matchCompatibility, parseCompatibility } from "./compatibility";
import {
  applyMovementDuringCount,
  computeCountVariance,
  countRequiresOwnerValidation,
  summarizeCount,
} from "./count";
import { allocateLandedCosts, landedUnitCost } from "./landedCosts";
import { checkSalePrice, computeMarginRate } from "./price";
import {
  assertPurchaseLineEdit,
  assertPurchaseOrderTransition,
  computePurchaseOrderTotal,
  isAberrantPrice,
  isPurchaseOrderLate,
  priceVariance,
  statusAfterReceipt,
} from "./purchase";
import { suggestReorder } from "./reorder";
import { isScannerBurst, isValidEan, looksLikeBarcode, tokenizeProductQuery } from "./search";
import { stockSettingsFrom } from "./settings";
import { assertCountTransition, assertTransferTransition, transferShortfalls } from "./transfer";
import { computeValuation, dormantBucket, reconstructStockAt } from "./valuation";

describe("suggestReorder (RG-M07-07)", () => {
  it("exemple du PRD : min 10, max 30, prévisionnel 6, pack 12 → 24", () => {
    expect(suggestReorder({ projected: 6, minStock: 10, maxStock: 30, packSize: 12 })).toEqual({
      quantity: 24,
      reason: "below_min",
    });
  });
  it("arrondi au multiple supérieur du conditionnement", () => {
    expect(
      suggestReorder({ projected: 6, minStock: 10, maxStock: 30, packSize: 10 })?.quantity,
    ).toBe(30);
  });
  it("maxStock absent → 2 × min ; reorderQty prioritaire si plus grand", () => {
    expect(suggestReorder({ projected: 4, minStock: 10 })?.quantity).toBe(16);
    expect(suggestReorder({ projected: 4, minStock: 10, reorderQty: 40 })?.quantity).toBe(40);
  });
  it("backorders non couverts s'ajoutent toujours", () => {
    expect(suggestReorder({ projected: 20, minStock: 10, uncoveredBackorders: 3 })).toEqual({
      quantity: 3,
      reason: "backorders",
    });
    expect(
      suggestReorder({ projected: 6, minStock: 10, maxStock: 30, uncoveredBackorders: 2 })
        ?.quantity,
    ).toBe(26);
  });
  it("rien à commander au-dessus du mini", () => {
    expect(suggestReorder({ projected: 10, minStock: 10 })).toBeNull();
    expect(suggestReorder({ projected: 0, minStock: 0 })).toBeNull();
  });
});

describe("allocateLandedCosts", () => {
  it("10 000 FCFA sur 3 lignes : prorata, reste d'arrondi sur la dernière", () => {
    const out = allocateLandedCosts(10_000, [30_000, 30_000, 30_000]);
    expect(out).toEqual([3333, 3333, 3334]);
    expect(out.reduce((s, v) => s + v, 0)).toBe(10_000);
  });
  it("prorata de la valeur", () => {
    expect(allocateLandedCosts(10_000, [76_000, 24_000])).toEqual([7600, 2400]);
  });
  it("lignes à valeur nulle : répartition égale ; aucune ligne → []", () => {
    expect(allocateLandedCosts(100, [0, 0])).toEqual([50, 50]);
    expect(allocateLandedCosts(100, [])).toEqual([]);
  });
  it("coût unitaire frais inclus", () => {
    expect(landedUnitCost(3800, 7600, 20)).toBe(4180);
    expect(landedUnitCost(4000, 1000, 45, 10)).toBe(4222);
  });
});

describe("checkSalePrice (RG-M07-13)", () => {
  it("exemple : CMP 37 000, mini 40 000, 42 000 − 10 % → 37 800 sous le mini", () => {
    const r = checkSalePrice({
      unitPrice: 42_000,
      discountRate: 10,
      minSalePrice: 40_000,
      averageCost: 37_000,
    });
    expect(r).toMatchObject({
      netUnitPrice: 37_800,
      belowMin: true,
      belowCost: false,
      requiresOverride: true,
    });
  });
  it("vente à perte : motif obligatoire", () => {
    const r = checkSalePrice({ unitPrice: 35_000, minSalePrice: 30_000, averageCost: 37_000 });
    expect(r).toMatchObject({ belowCost: true, belowMin: false, reasonRequired: true, ok: false });
  });
  it("prix correct", () => {
    expect(checkSalePrice({ unitPrice: 45_000, averageCost: 37_000 }).ok).toBe(true);
    expect(computeMarginRate(45_000, 36_000)).toBe(20);
    expect(computeMarginRate(0, 1)).toBeNull();
  });
});

describe("matchCompatibility (RG-M07-02)", () => {
  const entries = ["TOYOTA|COROLLA|2014-2019", "HYUNDAI|*|*"];
  it("marque/modèle/année, casse ignorée", () => {
    expect(matchCompatibility(entries, { make: "Toyota", model: "Corolla", year: 2016 })).toBe(
      true,
    );
    expect(matchCompatibility(entries, { make: "toyota", model: "corolla", year: 2020 })).toBe(
      false,
    );
    expect(matchCompatibility(entries, { make: "Toyota", model: "Yaris", year: 2016 })).toBe(false);
  });
  it("jokers et année inconnue", () => {
    expect(matchCompatibility(entries, { make: "Hyundai", model: "Tucson", year: 2020 })).toBe(
      true,
    );
    expect(matchCompatibility(entries, { make: "Toyota", model: "Corolla", year: null })).toBe(
      true,
    );
    expect(matchCompatibility(entries, { make: null, model: "Corolla" })).toBe(false);
  });
  it("parse et formatage", () => {
    expect(parseCompatibility("TOYOTA|HILUX|2016")).toEqual({
      make: "TOYOTA",
      model: "HILUX",
      yearFrom: 2016,
      yearTo: 2016,
    });
    expect(parseCompatibility("PEUGEOT|301|2015-")).toEqual({
      make: "PEUGEOT",
      model: "301",
      yearFrom: 2015,
      yearTo: null,
    });
    expect(
      formatCompatibility({ make: "Toyota", model: "Corolla", yearFrom: 2014, yearTo: 2019 }),
    ).toBe("TOYOTA|COROLLA|2014-2019");
    expect(formatCompatibility({ make: "Citroën" })).toBe("CITROEN|*|*");
    expect(() => formatCompatibility({ make: "Kia", yearFrom: 2020, yearTo: 2010 })).toThrow();
  });
});

describe("inventaire (RG-M07-10)", () => {
  it("écart en quantité et en valeur", () => {
    expect(computeCountVariance({ expectedQty: 27, countedQty: 26, unitCost: 3688 })).toEqual({
      variance: -1,
      varianceValue: -3688,
    });
    expect(
      computeCountVariance({ expectedQty: 27, countedQty: null, unitCost: 3688 }).variance,
    ).toBe(0);
  });
  it("mouvements pendant le comptage", () => {
    expect(applyMovementDuringCount({ expectedQty: 10, countedQty: null }, -2)).toEqual({
      expectedQty: 8,
      movedAfterCount: false,
    });
    expect(applyMovementDuringCount({ expectedQty: 10, countedQty: 10 }, -2)).toEqual({
      expectedQty: 10,
      movedAfterCount: true,
    });
  });
  it("résumé et seuil de validation OWNER", () => {
    const s = summarizeCount([
      { expectedQty: 10, countedQty: 9, unitCost: 30_000 },
      { expectedQty: 5, countedQty: 6, unitCost: 25_000 },
      { expectedQty: 3, countedQty: null, unitCost: 1 },
    ]);
    expect(s).toEqual({
      linesTotal: 3,
      linesCounted: 2,
      linesWithVariance: 2,
      netValue: -5_000,
      absoluteValue: 55_000,
    });
    expect(countRequiresOwnerValidation(s.absoluteValue, 50_000)).toBe(true);
    expect(countRequiresOwnerValidation(50_000, 50_000)).toBe(false);
  });
});

describe("réservations (RG-M07-04)", () => {
  it("réserve le disponible, le reste en BACKORDERED", () => {
    expect(planReservation(4, 1)).toEqual({ reserved: 1, backordered: 0 });
    expect(planReservation(0, 1)).toEqual({ reserved: 0, backordered: 1 });
    expect(planReservation(-3, 2)).toEqual({ reserved: 0, backordered: 2 });
    expect(planReservation(1, 3)).toEqual({ reserved: 1, backordered: 2 });
  });
  it("prévisionnel = disponible + commandes en cours", () => {
    expect(projectedAvailable({ onHand: 4, reserved: 2 }, [{ quantity: 10, receivedQty: 6 }])).toBe(
      6,
    );
  });
  it("backorders servis par ordre d'arrivée, le dernier en partie", () => {
    const d = (n: number) => new Date(2026, 0, n);
    expect(
      allocateBackorders(
        [
          { id: "b", quantity: 2, createdAt: d(2) },
          { id: "a", quantity: 3, createdAt: d(1) },
          { id: "c", quantity: 1, createdAt: d(3) },
        ],
        4,
      ),
    ).toEqual([
      { id: "a", quantity: 3, partial: false },
      { id: "b", quantity: 1, partial: true },
    ]);
  });
  it("réservation ancienne sur OR inactif", () => {
    const now = new Date("2026-10-19T00:00:00Z");
    expect(
      isStaleReservation(
        { status: "RESERVED", createdAt: new Date("2026-09-01T00:00:00Z") },
        false,
        now,
      ),
    ).toBe(true);
    expect(
      isStaleReservation(
        { status: "RESERVED", createdAt: new Date("2026-09-01T00:00:00Z") },
        true,
        now,
      ),
    ).toBe(false);
  });
});

describe("bons de commande (RG-M07-08)", () => {
  it("total et statuts de réception", () => {
    const lines = [
      { quantity: 20, receivedQty: 20, unitCost: 3600 },
      { quantity: 10, receivedQty: 6, unitCost: 18_000 },
    ];
    expect(computePurchaseOrderTotal(lines)).toBe(252_000);
    expect(statusAfterReceipt(lines)).toBe("PARTIALLY_RECEIVED");
    expect(statusAfterReceipt([{ quantity: 10, receivedQty: 10 }])).toBe("RECEIVED");
    expect(
      computePurchaseOrderTotal([
        { quantity: 2080, receivedQty: 0, unitCost: 4000, quantityScale: 10 },
      ]),
    ).toBe(832_000);
  });
  it("transitions", () => {
    expect(() => assertPurchaseOrderTransition("DRAFT", "SENT")).not.toThrow();
    expect(() => assertPurchaseOrderTransition("PARTIALLY_RECEIVED", "CANCELLED")).toThrow(
      "soldez le reliquat",
    );
    expect(() => assertPurchaseOrderTransition("RECEIVED", "SENT")).toThrow();
  });
  it("édition des lignes", () => {
    expect(() => assertPurchaseLineEdit("DRAFT", { kind: "remove" })).not.toThrow();
    expect(() => assertPurchaseLineEdit("SENT", { kind: "add" })).not.toThrow();
    expect(() => assertPurchaseLineEdit("SENT", { kind: "remove" })).toThrow();
    expect(() =>
      assertPurchaseLineEdit("PARTIALLY_RECEIVED", { kind: "update", quantity: 4, receivedQty: 6 }),
    ).toThrow();
    expect(() => assertPurchaseLineEdit("RECEIVED", { kind: "add" })).toThrow();
  });
  it("écarts de prix et prix aberrant", () => {
    expect(priceVariance(3600, 3800)).toEqual({
      expected: 3600,
      actual: 3800,
      diff: 200,
      pct: 5.6,
    });
    expect(priceVariance(3600, 3600)).toBeNull();
    expect(isAberrantPrice(38_000, 3800)).toBe(true);
    expect(isAberrantPrice(380, 3800)).toBe(true);
    expect(isAberrantPrice(4000, 3800)).toBe(false);
    expect(isAberrantPrice(4000, 0)).toBe(false);
  });
  it("retard", () => {
    const now = new Date("2026-10-19T08:00:00Z");
    expect(
      isPurchaseOrderLate({ status: "SENT", expectedAt: new Date("2026-10-18T00:00:00Z") }, now),
    ).toBe(true);
    expect(
      isPurchaseOrderLate(
        { status: "RECEIVED", expectedAt: new Date("2026-10-18T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });
});

describe("valorisation et dormantes (RG-M07-09/11)", () => {
  const items = [
    {
      productId: "p1",
      siteId: "YOP",
      category: "Filtration",
      onHand: 27,
      quantityScale: 1,
      averageCost: 3688,
    },
    {
      productId: "p2",
      siteId: "COC",
      category: "Lubrifiants",
      onHand: 45,
      quantityScale: 10,
      averageCost: 4800,
    },
    {
      productId: "p3",
      siteId: "YOP",
      category: "Filtration",
      onHand: -2,
      quantityScale: 1,
      averageCost: 1000,
    },
  ];
  it("valeur par catégorie, négatifs à part", () => {
    const v = computeValuation(items, "category");
    expect(v.total).toBe(99_576 + 21_600);
    expect(v.groups[0]).toEqual({ key: "Filtration", value: 99_576, items: 1 });
    expect(v.negatives.map((n) => n.productId)).toEqual(["p3"]);
    expect(computeValuation(items, "site").groups.map((g) => g.key)).toEqual(["YOP", "COC"]);
  });
  it("reconstruction à date depuis les mouvements", () => {
    const r = reconstructStockAt(
      [
        {
          productId: "p1",
          siteId: "YOP",
          quantity: 12,
          costAfter: 3500,
          unitCost: 3500,
          createdAt: new Date("2026-01-01"),
        },
        {
          productId: "p1",
          siteId: "YOP",
          quantity: 20,
          costAfter: 3688,
          unitCost: 3800,
          createdAt: new Date("2026-03-01"),
        },
        {
          productId: "p1",
          siteId: "YOP",
          quantity: -5,
          costAfter: 3688,
          unitCost: 3688,
          createdAt: new Date("2026-05-01"),
        },
      ],
      new Date("2026-04-01"),
    );
    expect(r.quantities.get("p1|YOP")).toBe(32);
    expect(r.costs.get("p1")).toBe(3688);
  });
  it("tranches de dormance", () => {
    const now = new Date("2026-10-19T00:00:00Z");
    const created = new Date("2024-01-01T00:00:00Z");
    expect(
      dormantBucket({ onHand: 3, lastIssuedAt: new Date("2026-03-01"), createdAt: created }, now),
    ).toBe("dormant");
    expect(
      dormantBucket({ onHand: 3, lastIssuedAt: new Date("2025-03-01"), createdAt: created }, now),
    ).toBe("over_365");
    expect(
      dormantBucket({ onHand: 3, lastIssuedAt: new Date("2026-09-01"), createdAt: created }, now),
    ).toBeNull();
    expect(dormantBucket({ onHand: 0, lastIssuedAt: null, createdAt: created }, now)).toBeNull();
    expect(dormantBucket({ onHand: 1, lastIssuedAt: null, createdAt: created }, now)).toBe(
      "over_365",
    );
  });
});

describe("transferts et inventaires : états", () => {
  it("transitions", () => {
    expect(() => assertTransferTransition("DRAFT", "IN_TRANSIT")).not.toThrow();
    expect(() => assertTransferTransition("IN_TRANSIT", "CANCELLED")).toThrow();
    expect(() => assertCountTransition("IN_PROGRESS", "SUBMITTED")).not.toThrow();
    expect(() => assertCountTransition("VALIDATED", "CANCELLED")).toThrow();
  });
  it("écart de réception : 5 envoyées, 4 reçues → 1 à justifier", () => {
    expect(transferShortfalls([{ lineId: "l1", quantity: 5, receivedQty: 4 }])).toEqual([
      { lineId: "l1", shortfall: 1 },
    ]);
    expect(() => transferShortfalls([{ lineId: "l1", quantity: 5, receivedQty: 6 }])).toThrow();
  });
});

describe("recherche, codes-barres et paramètres", () => {
  it("découpe de la recherche", () => {
    expect(tokenizeProductQuery("  filtre huile   corolla ")).toEqual([
      "filtre",
      "huile",
      "corolla",
    ]);
  });
  it("codes-barres", () => {
    expect(looksLikeBarcode("4987654321098")).toBe(true);
    expect(looksLikeBarcode("04152-YZZA1")).toBe(false);
    expect(isValidEan("4006381333931")).toBe(true);
    expect(isValidEan("4006381333932")).toBe(false);
    expect(isValidEan("96385074")).toBe(true);
  });
  it("douchette : touches à moins de 50 ms", () => {
    expect(isScannerBurst([0, 10, 20, 30, 40, 50, 60])).toBe(true);
    expect(isScannerBurst([0, 10, 200, 210, 220, 230])).toBe(false);
    expect(isScannerBurst([0, 10, 20])).toBe(false);
  });
  it("paramètres stock avec défauts", () => {
    expect(stockSettingsFrom(null).countApprovalThreshold).toBe(50_000);
    expect(stockSettingsFrom({ stock: { allowNegative: true, dormantDays: 90 } })).toMatchObject({
      allowNegative: true,
      dormantDays: 90,
    });
  });
});

describe("buildPurchaseOrderMessage (US-M07-07)", () => {
  it("liste les lignes et le total", async () => {
    const { buildPurchaseOrderMessage } = await import("./purchaseMessage");
    const { subject, body } = buildPurchaseOrderMessage({
      garageName: "Excellence Auto",
      siteName: "Yopougon",
      number: "BC-YOP-2026-00008",
      supplierName: "CFAO Motors",
      expectedAt: "25/10/2026",
      lines: [
        {
          sku: "FH-TOY-001",
          name: "Filtre à huile",
          unit: "pièce",
          quantity: 20,
          quantityScale: 1,
          unitCost: 3600,
        },
        {
          sku: "HU-5W30",
          name: "Huile 5W30",
          unit: "litre",
          quantity: 2080,
          quantityScale: 10,
          unitCost: 4000,
        },
      ],
      total: 904_000,
    });
    expect(subject).toBe("Bon de commande BC-YOP-2026-00008 — Excellence Auto");
    expect(body).toContain("- 20 pièce × Filtre à huile (réf. FH-TOY-001) à 3 600 FCFA");
    expect(body).toContain("- 208 litre × Huile 5W30");
    expect(body).toContain("Total HT : 904 000 FCFA");
    expect(body).toContain("Livraison souhaitée le 25/10/2026.");
  });
});
