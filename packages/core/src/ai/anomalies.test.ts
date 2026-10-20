import { describe, expect, it } from "vitest";
import {
  anomalyDedupeKey,
  detectBillingGapAnomalies,
  detectCashGapAnomalies,
  detectDiscountAnomalies,
  detectPriceBelowCostAnomalies,
  detectStockShrinkAnomalies,
  detectVoidSpikeAnomalies,
  type DiscountDoc,
} from "./anomalies";

const NOW = new Date("2026-10-20T06:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("RG-M17-22 — anomalies", () => {
  it("US-M17-11 — remise de 35 % pour un conseiller à 4 % de moyenne", () => {
    const history: DiscountDoc[] = Array.from({ length: 10 }, (_, i) => ({
      id: `h${i}`,
      number: `FAC-2026-0004${i}`,
      advisorId: "koffi",
      advisorName: "Koffi A.",
      issuedAt: day(10 + i),
      documentRate: i % 2 ? 3 : 5,
      maxLineRate: 0,
    }));
    const anomalies = detectDiscountAnomalies(
      [
        ...history,
        {
          id: "inv455",
          number: "FAC-2026-000455",
          advisorId: "koffi",
          advisorName: "Koffi A.",
          issuedAt: day(0.5),
          documentRate: 35,
          maxLineRate: 0,
        },
      ],
      day(1),
    );
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.title).toBe("Remise inhabituelle : 35 % sur FAC-2026-000455 (Koffi A.)");
    expect(anomalies[0]!.body).toContain("4 %");
  });

  it("remise ≤ 15 % jamais signalée ; seuil = moyenne + 3σ pour un conseiller généreux", () => {
    const generous: DiscountDoc[] = [10, 20, 30, 25, 15].map((rate, i) => ({
      id: `g${i}`,
      number: null,
      advisorId: "a",
      advisorName: "A",
      issuedAt: day(5 + i),
      documentRate: rate,
      maxLineRate: 0,
    }));
    const recent = (rate: number, line = 0): DiscountDoc => ({
      id: `r${rate}`,
      number: "FAC",
      advisorId: "a",
      advisorName: "A",
      issuedAt: day(0.1),
      documentRate: rate,
      maxLineRate: line,
    });
    expect(detectDiscountAnomalies([...generous, recent(14)], day(1))).toEqual([]);
    expect(detectDiscountAnomalies([...generous, recent(40)], day(1))).toEqual([]);
    expect(detectDiscountAnomalies([...generous, recent(5, 80)], day(1))).toHaveLength(1);
    // Les factures anciennes ne sont pas re-signalées.
    expect(
      detectDiscountAnomalies([recent(5), { ...recent(50), issuedAt: day(3) }], day(1)),
    ).toEqual([]);
  });

  it("écarts de caisse : cumul < −20 000 FCFA ou 3 négatifs consécutifs", () => {
    const s = (id: string, cashier: string, n: number, difference: number) => ({
      id,
      cashierId: cashier,
      cashierName: cashier,
      closedAt: day(n),
      difference,
    });
    const result = detectCashGapAnomalies(
      [
        s("1", "awa", 5, -15_000),
        s("2", "awa", 4, -6_000),
        s("3", "yao", 3, -100),
        s("4", "yao", 2, -100),
        s("5", "yao", 1, -100),
        s("6", "zie", 3, -5_000),
        s("7", "zie", 2, 2_000),
        s("8", "zie", 1, -5_000),
        s("9", "old", 40, -90_000),
      ],
      NOW,
    );
    expect(result.map((a) => a.objectId).sort()).toEqual(["awa", "yao"]);
    expect(result.find((a) => a.objectId === "awa")!.body).toContain("-21 000 FCFA");
  });

  it("démarque : inventaire valorisé > 50 000 FCFA ou > 3 ajustements négatifs", () => {
    const m = (
      productId: string,
      type: "ADJUSTMENT" | "COUNT_CORRECTION",
      quantity: number,
      unitCost: number,
    ) => ({
      productId,
      productName: productId,
      type,
      quantity,
      unitCost,
      createdAt: day(2),
    });
    const result = detectStockShrinkAnomalies(
      [
        m("batterie", "COUNT_CORRECTION", -2, 30_000),
        m("filtre", "COUNT_CORRECTION", -10, 4_000),
        ...Array.from({ length: 4 }, () => m("huile", "ADJUSTMENT", -1, 5_000)),
        ...Array.from({ length: 3 }, () => m("bougie", "ADJUSTMENT", -1, 2_000)),
        m("pneu", "ADJUSTMENT", 5, 40_000),
      ],
      NOW,
    );
    expect(result.map((a) => a.objectId).sort()).toEqual(["batterie", "huile"]);
  });

  it("pièce sortie non facturée et temps pointé > 2 × vendu", () => {
    const result = detectBillingGapAnomalies([
      {
        repairOrderId: "ro1",
        repairOrderNumber: "OR-YOP-2026-00042",
        invoiceId: "inv1",
        invoiceNumber: "FAC-2026-000100",
        issued: [
          { productId: "plaq", productName: "Plaquettes AV", quantity: 1 },
          { productId: "huile", productName: "Huile 5W30", quantity: 0 },
        ],
        billedProductIds: [],
        workedHours: 3,
        soldHours: 1.4,
      },
      {
        repairOrderId: "ro2",
        repairOrderNumber: "OR-2",
        invoiceId: "inv2",
        invoiceNumber: null,
        issued: [{ productId: "f", productName: "Filtre", quantity: 1 }],
        billedProductIds: ["f"],
        workedHours: 2.8,
        soldHours: 1.4,
      },
    ]);
    expect(result.map((a) => a.code)).toEqual(["anomaly.part_not_billed", "anomaly.time_overrun"]);
    expect(result[0]!.body).toBe("Plaquettes AV ×1 absente(s) de FAC-2026-000100.");
    expect(result[1]!.body).toBe("3,0 h pointées pour 1,4 h vendues.");
  });

  it("prix sous le coût moyen : une alerte par facture", () => {
    const result = detectPriceBelowCostAnomalies([
      {
        invoiceId: "i1",
        invoiceNumber: "FAC-1",
        description: "Batterie",
        netUnitPrice: 40_000,
        averageCost: 45_000,
      },
      {
        invoiceId: "i1",
        invoiceNumber: "FAC-1",
        description: "Filtre",
        netUnitPrice: 2_000,
        averageCost: 2_500,
      },
      {
        invoiceId: "i2",
        invoiceNumber: "FAC-2",
        description: "MO",
        netUnitPrice: 15_000,
        averageCost: 0,
      },
      {
        invoiceId: "i3",
        invoiceNumber: "FAC-3",
        description: "Huile",
        netUnitPrice: 6_000,
        averageCost: 5_000,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toContain("Batterie : 40 000 FCFA pour un coût de 45 000 FCFA");
  });

  it("annulations : plus de 3 en 7 jours par le même utilisateur", () => {
    const v = (userId: string, n: number) => ({ userId, userName: userId, at: day(n) });
    const result = detectVoidSpikeAnomalies(
      [
        v("a", 1),
        v("a", 2),
        v("a", 3),
        v("a", 4),
        v("b", 1),
        v("b", 2),
        v("b", 3),
        v("b", 9),
        v("b", 10),
      ],
      NOW,
    );
    expect(result.map((a) => a.objectId)).toEqual(["a"]);
  });

  it("dédoublonnage : par document, ou par semaine pour les cumuls", () => {
    const doc = {
      code: "anomaly.discount" as const,
      objectId: "inv",
      title: "",
      body: "",
      link: "",
    };
    const cumul = { ...doc, code: "anomaly.cash_gap" as const, objectId: "awa" };
    expect(anomalyDedupeKey(doc, NOW)).toBe("anomaly.discount:inv");
    expect(anomalyDedupeKey(cumul, NOW)).not.toBe(anomalyDedupeKey(cumul, day(8)));
  });
});
