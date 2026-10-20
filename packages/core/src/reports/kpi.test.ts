import { describe, expect, it } from "vitest";
import { canReadKpi, KPI_CODES, kpiResult, kpiValueOf, MARGIN_KPIS } from "./kpi";
import { computeMargins, computeRevenue } from "./revenue";

// 3 factures 100 000 / 250 000 / 85 000 HT + avoir 35 000 → CA 400 000 (M12 §12).
const revenue = computeRevenue([
  {
    invoiceType: "INVOICE",
    lineType: "LABOR",
    subtotal: 135_000,
    total: 159_300,
    cost: 0,
    uncostedLines: 0,
  },
  {
    invoiceType: "INVOICE",
    lineType: "PART",
    subtotal: 300_000,
    total: 354_000,
    cost: 210_000,
    uncostedLines: 0,
  },
  {
    invoiceType: "CREDIT_NOTE",
    lineType: "PART",
    subtotal: 35_000,
    total: 41_300,
    cost: 20_000,
    uncostedLines: 0,
  },
]);
const margins = computeMargins(revenue, { cost: 45_000, estimated: true });

describe("dashboard.kpi — assemblage des indicateurs (M12 §8)", () => {
  it("reprend les formules de core/reports sans les réécrire", () => {
    const facts = { revenue, margins, invoiceCount: 3, avgTicket: 133_333 };
    expect(kpiValueOf("revenue_ht", facts).value).toBe(400_000);
    expect(kpiValueOf("revenue_ht", facts).value).toBe(revenue.ht);
    expect(kpiValueOf("revenue_ttc", facts).value).toBe(revenue.ttc);
    expect(kpiValueOf("gross_margin", facts)).toMatchObject({
      value: margins.grossMargin,
      denominator: 400_000,
      estimated: true,
    });
    expect(kpiValueOf("parts_margin", facts)).toMatchObject({ value: margins.partsMargin });
    expect(kpiValueOf("avg_ticket", facts)).toEqual({
      value: 133_333,
      numerator: 400_000,
      denominator: 3,
    });
  });

  it("taux d'acceptation : null si aucun devis décidé (division par zéro → « — »)", () => {
    expect(
      kpiValueOf("quote_acceptance", {
        acceptance: { decided: 0, accepted: 0, countRate: null, valueRate: null },
      }).value,
    ).toBeNull();
    expect(
      kpiValueOf("quote_acceptance", {
        acceptance: { decided: 4, accepted: 3, countRate: 0.75, valueRate: 0.6 },
      }),
    ).toEqual({ value: 0.75, numerator: 3, denominator: 4 });
  });

  it("comparaison : valeur précédente et variation ; jamais pour un instantané", () => {
    expect(kpiResult("collected", { collected: 120_000 }, { collected: 100_000 })).toEqual({
      metric: "collected",
      value: 120_000,
      previous: 100_000,
      delta: { kind: "pct", pct: 20 },
    });
    expect(kpiResult("collected", { collected: 5_000 }, { collected: 0 }).delta).toEqual({
      kind: "new",
    });
    expect(kpiResult("receivables", { receivablesTotal: 900 }, { receivablesTotal: 1 })).toEqual({
      metric: "receivables",
      value: 900,
    });
    expect(kpiResult("collected", { collected: 1 })).toEqual({ metric: "collected", value: 1 });
  });

  it("M12 §10 — les marges exigent report:financial, les autres cartes dashboard:owner suffit", () => {
    const owner = new Set(["dashboard:owner"]);
    const accountant = new Set(["report:financial", "report:read"]);
    const manager = new Set(["report:read", "reminder:read"]);
    for (const code of MARGIN_KPIS) {
      expect(canReadKpi(code, owner)).toBe(false);
      expect(canReadKpi(code, accountant)).toBe(true);
      expect(canReadKpi(code, manager)).toBe(false);
    }
    expect(canReadKpi("revenue_ht", owner)).toBe(true);
    expect(canReadKpi("revenue_ht", manager)).toBe(false);
    expect(canReadKpi("quote_acceptance", manager)).toBe(true);
    expect(canReadKpi("recovered_by_reminders", manager)).toBe(true);
    expect(canReadKpi("receivables", new Set<string>())).toBe(false);
    expect(KPI_CODES).toHaveLength(10);
  });
});
