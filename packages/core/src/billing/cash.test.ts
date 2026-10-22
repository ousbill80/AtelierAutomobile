import { describe, expect, it } from "vitest";
import {
  closeCash,
  decideExpense,
  expensesByCategory,
  readClosingSummary,
  varianceByCashier,
} from "./cash";

describe("RG-M08-30 — décision sur une dépense en attente", () => {
  const pending = { status: "PENDING" as const, sessionClosed: false };

  it("valide ou refuse une dépense en attente", () => {
    expect(decideExpense({ ...pending, decision: "approve", comment: null })).toBe("APPROVED");
    expect(decideExpense({ ...pending, decision: "reject", comment: "Pas de reçu" })).toBe(
      "REJECTED",
    );
  });

  it("exige un motif de refus d'au moins 3 caractères", () => {
    expect(() => decideExpense({ ...pending, decision: "reject", comment: "" })).toThrow(
      /motif du refus/,
    );
    expect(() => decideExpense({ ...pending, decision: "reject", comment: "  ok " })).toThrow(
      /motif du refus/,
    );
  });

  it("refuse une deuxième décision", () => {
    expect(() =>
      decideExpense({ status: "APPROVED", sessionClosed: false, decision: "reject", comment: "x" }),
    ).toThrow(/déjà validée/);
    expect(() =>
      decideExpense({
        status: "REJECTED",
        sessionClosed: false,
        decision: "approve",
        comment: null,
      }),
    ).toThrow(/déjà refusée/);
  });

  it("refuse une décision sur une caisse clôturée", () => {
    expect(() =>
      decideExpense({ status: "PENDING", sessionClosed: true, decision: "approve", comment: null }),
    ).toThrow(/clôturée/);
  });
});

describe("RG-M08-28/30 — clôture bloquée par une dépense en attente", () => {
  const base = { expected: 100_000, counted: 100_000, notes: null, varianceAlert: 5_000 };

  it("bloque la clôture tant qu'une dépense attend une décision", () => {
    expect(() => closeCash({ ...base, pendingExpenses: 1 })).toThrow(
      /Une dépense attend la validation/,
    );
    expect(() => closeCash({ ...base, pendingExpenses: 3 })).toThrow(/3 dépenses attendent/);
  });

  it("clôture normalement sans dépense en attente", () => {
    expect(closeCash({ ...base, pendingExpenses: 0 })).toEqual({ difference: 0, alert: false });
  });
});

describe("expensesByCategory", () => {
  it("regroupe par catégorie, trie par montant décroissant puis par nom", () => {
    expect(
      expensesByCategory([
        { category: "Carburant", amount: 12_500 },
        { category: "Divers", amount: 2_000 },
        { category: "Carburant", amount: 7_500 },
        { category: "Transport", amount: 2_000 },
      ]),
    ).toEqual([
      { category: "Carburant", amount: 20_000, count: 2 },
      { category: "Divers", amount: 2_000, count: 1 },
      { category: "Transport", amount: 2_000, count: 1 },
    ]);
  });

  it("renvoie une liste vide sans dépense", () => {
    expect(expensesByCategory([])).toEqual([]);
  });
});

describe("M08 §11 — écarts par caissier", () => {
  const closed = new Date("2026-10-19T18:00:00.000Z");

  it("agrège les sessions clôturées et trie par écart absolu", () => {
    const rows = varianceByCashier([
      { cashierId: "a", cashierName: "Awa", difference: -2_500, closedAt: closed },
      { cashierId: "a", cashierName: "Awa", difference: 2_500, closedAt: closed },
      { cashierId: "a", cashierName: "Awa", difference: 0, closedAt: closed },
      { cashierId: "b", cashierName: "Bakary", difference: -500, closedAt: closed },
      // Session ouverte : ignorée.
      { cashierId: "b", cashierName: "Bakary", difference: null, closedAt: null },
    ]);
    expect(rows).toEqual([
      {
        cashierId: "a",
        cashierName: "Awa",
        sessions: 3,
        withVariance: 2,
        net: 0,
        absolute: 5_000,
        worstShortage: -2_500,
      },
      {
        cashierId: "b",
        cashierName: "Bakary",
        sessions: 1,
        withVariance: 1,
        net: -500,
        absolute: 500,
        worstShortage: -500,
      },
    ]);
  });

  it("n'invente pas de manquant quand il n'y a que des excédents", () => {
    const [row] = varianceByCashier([
      { cashierId: "a", cashierName: "Awa", difference: 1_000, closedAt: closed },
    ]);
    expect(row?.worstShortage).toBe(0);
  });
});

describe("readClosingSummary", () => {
  it("relit un instantané persisté", () => {
    const summary = readClosingSummary({
      openingFloat: 50_000,
      byMethod: { CASH: 280_000, WAVE: 85_000 },
      totalReceived: 365_000,
      cashPayments: 280_000,
      expensesTotal: 12_500,
      dropsTotal: 40_000,
      cashRefunds: 5_000,
      expectedCash: 272_500,
      countedCash: 270_000,
      difference: -2_500,
      pendingCheques: 0,
      counts: { payments: 4, expenses: 1, drops: 1, refunds: 1 },
    });
    expect(summary?.byMethod).toEqual({ CASH: 280_000, WAVE: 85_000 });
    expect(summary?.difference).toBe(-2_500);
    expect(summary?.counts.payments).toBe(4);
  });

  it("renvoie null pour une session clôturée avant l'instantané", () => {
    expect(readClosingSummary(null)).toBeNull();
    expect(readClosingSummary([])).toBeNull();
  });

  it("neutralise les valeurs invalides", () => {
    const summary = readClosingSummary({ byMethod: { CASH: "x" }, counts: null });
    expect(summary?.byMethod).toEqual({ CASH: 0 });
    expect(summary?.counts).toEqual({ payments: 0, expenses: 0, drops: 0, refunds: 0 });
  });
});
