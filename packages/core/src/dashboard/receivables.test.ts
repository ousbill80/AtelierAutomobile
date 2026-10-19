import { describe, expect, it } from "vitest";
import {
  agingBucket,
  computeReceivables,
  daysLate,
  dso,
  topUnpaid,
  type ReceivableInvoiceLike,
} from "./receivables";

const TODAY = "2026-10-18";
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

function inv(partial: Partial<ReceivableInvoiceLike>): ReceivableInvoiceLike {
  return {
    id: Math.random().toString(36),
    type: "INVOICE",
    status: "ISSUED",
    balance: 100_000,
    dueDate: d(TODAY),
    customerId: "c1",
    customerName: "Client 1",
    ...partial,
  };
}

describe("balance âgée (RG-M12-18)", () => {
  it("tranches aux bornes 0, 1, 30, 31, 60, 61, 90, 91 j", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, -5].map(agingBucket)).toEqual([
      "notDue",
      "d1_30",
      "d1_30",
      "d31_60",
      "d31_60",
      "d61_90",
      "d61_90",
      "d90plus",
      "notDue",
    ]);
  });

  it("jours de retard en dates civiles ; sans échéance = non échu", () => {
    expect(daysLate(d("2026-09-18"), TODAY)).toBe(30);
    expect(daysLate(null, TODAY)).toBe(0);
  });
});

describe("créances en cours (RG-M12-17)", () => {
  it("somme les soldes ouverts, en retard, > 30 j et litiges à part", () => {
    const summary = computeReceivables(
      [
        inv({ balance: 185_000, dueDate: d("2026-10-03") }), // 15 j
        inv({ balance: 1_240_000, dueDate: d("2026-08-01"), status: "OVERDUE" }), // 78 j
        inv({ balance: 50_000, dueDate: d("2026-11-01"), status: "PARTIALLY_PAID" }), // non échu
        inv({ balance: 30_000, dueDate: d("2026-09-01"), status: "DISPUTED" }), // 47 j
        inv({ balance: 99_000, status: "PAID" }),
        inv({ balance: 99_000, status: "DRAFT" }),
        inv({ balance: 99_000, type: "CREDIT_NOTE" }),
        inv({ balance: 99_000, type: "DEPOSIT" }),
      ],
      TODAY,
    );
    expect(summary).toEqual({
      total: 1_505_000,
      count: 4,
      overdue: 1_455_000,
      over30: 1_270_000,
      disputed: 30_000,
      buckets: { notDue: 50_000, d1_30: 185_000, d31_60: 30_000, d61_90: 1_240_000, d90plus: 0 },
    });
  });

  it("aucune facture → tout à zéro", () => {
    expect(computeReceivables([], TODAY).total).toBe(0);
  });
});

describe("top impayés", () => {
  it("regroupe par client et trie par solde décroissant", () => {
    const top = topUnpaid(
      [
        inv({ customerId: "a", customerName: "A", balance: 100 }),
        inv({ customerId: "b", customerName: "B", balance: 300, dueDate: d("2026-09-01") }),
        inv({ customerId: "a", customerName: "A", balance: 250 }),
        inv({ customerId: "c", customerName: "C", balance: 10, status: "PAID" }),
      ],
      TODAY,
      2,
    );
    expect(top).toEqual([
      { customerId: "a", customerName: "A", balance: 350, invoiceCount: 2, maxDaysLate: 0 },
      { customerId: "b", customerName: "B", balance: 300, invoiceCount: 1, maxDaysLate: 47 },
    ]);
  });
});

describe("DSO (RG-M12-19)", () => {
  it("CA nul → null ; sinon arrondi en jours", () => {
    expect(dso(1_000_000, 0)).toBeNull();
    expect(dso(1_000_000, 3_000_000)).toBe(30);
  });
});
