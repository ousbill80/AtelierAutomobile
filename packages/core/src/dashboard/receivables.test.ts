import { describe, expect, it } from "vitest";
import {
  computeReceivables,
  dso,
  recoveredByReminders,
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
    billTo: "CUSTOMER",
    balance: 100_000,
    dueDate: d(TODAY),
    customerId: "c1",
    customerName: "Client 1",
    ...partial,
  };
}

describe("créances en cours et balance âgée (RG-M12-17/18, définitions M09)", () => {
  it("somme les soldes ouverts, en retard, > 30 j et litiges à part ; tranches M09", () => {
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
        inv({ balance: 99_000, billTo: "INSURANCE", dueDate: d("2026-08-01") }), // M16, hors M09
      ],
      TODAY,
    );
    expect(summary).toEqual({
      total: 1_505_000,
      count: 4,
      overdue: 1_455_000,
      over30: 1_270_000,
      disputed: 30_000,
      buckets: { notDue: 50_000, b0_30: 185_000, b31_60: 30_000, b61_90: 1_240_000, b90p: 0 },
    });
  });

  it("bornes des tranches : 0, 30, 31, 90, 91 j", () => {
    const at = (days: number) =>
      inv({ balance: 1, dueDate: new Date(d(TODAY).getTime() - days * 86_400_000) });
    const { buckets } = computeReceivables([at(0), at(30), at(31), at(90), at(91)], TODAY);
    expect(buckets).toEqual({ notDue: 1, b0_30: 1, b31_60: 1, b61_90: 1, b90p: 1 });
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

describe("récupéré grâce aux relances (RG-M12-22, A10)", () => {
  it("somme les attributions « reminder » dont le paiement est reçu dans la période", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-11-01T00:00:00Z");
    expect(
      recoveredByReminders(
        [
          { source: "reminder", amount: 185_000, receivedAt: new Date("2026-10-06T10:00:00Z") },
          { source: "reminder", amount: 600_000, receivedAt: new Date("2026-10-08T10:00:00Z") },
          { source: "call", amount: 50_000, receivedAt: new Date("2026-10-09T10:00:00Z") },
          { source: "spontaneous", amount: 70_000, receivedAt: new Date("2026-10-09T10:00:00Z") },
          { source: "reminder", amount: 1, receivedAt: new Date("2026-11-01T00:00:00Z") },
        ],
        from,
        to,
      ),
    ).toBe(785_000);
  });
});
