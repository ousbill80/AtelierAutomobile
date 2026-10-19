import { describe, expect, it } from "vitest";
import { DomainError } from "../errors";
import {
  ageBucket,
  agingSummary,
  allocatePayment,
  applyAllocation,
  attributePayment,
  buildStatement,
  computeDueDate,
  creditCheck,
  customerExposure,
  daysOverdue,
  decideCaseAction,
  distributePaidAcrossInstallments,
  evaluatePromise,
  isUnreachable,
  promisePausedUntil,
  remindableAmount,
  riskScore,
  statementFileName,
  statusAfterResume,
  validatePromiseInstallments,
  type AgingInvoice,
} from ".";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function inv(
  partial: Partial<AgingInvoice> & { balance: number; dueDate: Date | null },
): AgingInvoice {
  return {
    id: Math.random().toString(36),
    customerId: "c1",
    type: "INVOICE",
    status: "ISSUED",
    ...partial,
  };
}

describe("aging (RG-M09-01/02)", () => {
  it("calcule l'échéance et le retard", () => {
    expect(computeDueDate(d("2026-10-01"), 0)).toEqual(d("2026-10-01"));
    expect(computeDueDate(d("2026-10-01"), 30)).toEqual(d("2026-10-31"));
    expect(daysOverdue(d("2026-10-06"), d("2026-10-07"))).toBe(1);
    expect(daysOverdue(d("2026-10-06"), d("2026-10-01"))).toBe(0);
    expect(daysOverdue(null, d("2026-10-01"))).toBe(0);
  });

  it.each([
    [0, "notDue"],
    [1, "b0_30"],
    [30, "b0_30"],
    [31, "b31_60"],
    [60, "b31_60"],
    [61, "b61_90"],
    [90, "b61_90"],
    [91, "b90p"],
  ] as const)("ageBucket(%i) = %s", (days, bucket) => {
    expect(ageBucket(days)).toBe(bucket);
  });

  it("exemple SOTRA : chaque facture selon sa propre échéance, somme = total", () => {
    const asOf = d("2026-10-18");
    const s = agingSummary({
      asOf,
      invoices: [
        inv({ balance: 640_000, dueDate: d("2026-08-27"), status: "OVERDUE" }), // 52 j
        inv({ balance: 400_000, dueDate: d("2026-09-10"), status: "OVERDUE" }), // 38 j
        inv({ balance: 200_000, dueDate: d("2026-10-13"), status: "PARTIALLY_PAID" }), // 5 j
      ],
    });
    expect(s.total).toBe(1_240_000);
    expect(s.buckets.b31_60).toBe(1_040_000);
    expect(s.buckets.b0_30).toBe(200_000);
    expect(s.notDue + s.buckets.b0_30 + s.buckets.b31_60 + s.buckets.b61_90 + s.buckets.b90p).toBe(
      s.total,
    );
    expect(s.customersCount).toBe(1);
  });

  it("exclut pertes, payées, assurance ; avoirs et acomptes en crédits non affectés", () => {
    const asOf = d("2026-10-18");
    const s = agingSummary({
      asOf,
      unallocatedCredits: [10_000],
      invoices: [
        inv({ balance: 45_000, dueDate: d("2026-03-01"), status: "WRITTEN_OFF" }),
        inv({ balance: 0, dueDate: d("2026-03-01"), status: "PAID" }),
        inv({ balance: 90_000, dueDate: d("2026-09-01"), billTo: "INSURANCE" }),
        inv({ balance: -15_000, dueDate: null, type: "CREDIT_NOTE" }),
        inv({ balance: 100_000, dueDate: d("2026-10-20"), customerId: "c2" }),
      ],
    });
    expect(s.total).toBe(100_000);
    expect(s.notDue).toBe(100_000);
    expect(s.unallocatedCredits).toBe(-25_000);
  });

  it("customerExposure : litiges à part, plus ancienne échéance, retard max", () => {
    const asOf = d("2026-10-18");
    const e = customerExposure(
      [
        inv({ balance: 100_000, dueDate: d("2026-09-18"), status: "OVERDUE" }),
        inv({ balance: 50_000, dueDate: d("2026-08-01"), status: "DISPUTED" }),
        inv({ balance: 30_000, dueDate: d("2026-10-30") }),
      ],
      asOf,
    );
    expect(e).toEqual({
      totalDue: 180_000,
      overdueDue: 100_000,
      oldestDueDate: d("2026-09-18"),
      maxDaysOverdue: 30,
      disputedDue: 50_000,
    });
    expect(remindableAmount({ overdueDue: 100_000, unallocatedCredits: -20_000 })).toBe(80_000);
    expect(remindableAmount({ overdueDue: 10_000, unallocatedCredits: -20_000 })).toBe(0);
  });
});

describe("allocation (M08 minimal)", () => {
  const invoices = [
    {
      id: "b",
      status: "OVERDUE",
      total: 400_000,
      amountPaid: 0,
      balance: 400_000,
      dueDate: d("2026-09-10"),
      issuedAt: null,
    },
    {
      id: "a",
      status: "OVERDUE",
      total: 640_000,
      amountPaid: 0,
      balance: 640_000,
      dueDate: d("2026-08-27"),
      issuedAt: null,
    },
    {
      id: "x",
      status: "DISPUTED",
      total: 50_000,
      amountPaid: 0,
      balance: 50_000,
      dueDate: d("2026-01-01"),
      issuedAt: null,
    },
  ];

  it("plus ancienne échéance d'abord, litiges exclus, reliquat non affecté", () => {
    expect(allocatePayment({ amount: 700_000, invoices })).toEqual({
      allocations: [
        { invoiceId: "a", amount: 640_000 },
        { invoiceId: "b", amount: 60_000 },
      ],
      unallocated: 0,
    });
    expect(allocatePayment({ amount: 1_100_000, invoices }).unallocated).toBe(60_000);
  });

  it("affectation explicite contrôlée", () => {
    expect(
      allocatePayment({
        amount: 100_000,
        invoices,
        explicit: [{ invoiceId: "b", amount: 80_000 }],
      }),
    ).toEqual({
      allocations: [{ invoiceId: "b", amount: 80_000 }],
      unallocated: 20_000,
    });
    expect(() =>
      allocatePayment({
        amount: 100_000,
        invoices,
        explicit: [{ invoiceId: "b", amount: 500_000 }],
      }),
    ).toThrow(DomainError);
    expect(() =>
      allocatePayment({ amount: 10_000, invoices, explicit: [{ invoiceId: "b", amount: 20_000 }] }),
    ).toThrow(DomainError);
    expect(() => allocatePayment({ amount: 10.5, invoices })).toThrow(DomainError);
    expect(() => allocatePayment({ amount: 0, invoices })).toThrow(DomainError);
  });

  it("recalcule solde et statut", () => {
    expect(applyAllocation({ total: 185_000, amountPaid: 0, status: "OVERDUE" }, 185_000)).toEqual({
      amountPaid: 185_000,
      balance: 0,
      status: "PAID",
    });
    expect(applyAllocation({ total: 185_000, amountPaid: 0, status: "ISSUED" }, 85_000)).toEqual({
      amountPaid: 85_000,
      balance: 100_000,
      status: "PARTIALLY_PAID",
    });
    expect(
      applyAllocation({ total: 185_000, amountPaid: 0, status: "OVERDUE" }, 85_000).status,
    ).toBe("OVERDUE");
    expect(() => applyAllocation({ total: 100, amountPaid: 50, status: "ISSUED" }, 60)).toThrow(
      DomainError,
    );
  });
});

describe("promises (RG-M09-06)", () => {
  const today = d("2026-10-18");

  it("valide les échéances", () => {
    expect(() =>
      validatePromiseInstallments([{ amount: 600_000, date: d("2026-10-25") }], 1_240_000, today),
    ).not.toThrow();
    expect(() =>
      validatePromiseInstallments([{ amount: 600_000, date: d("2026-10-17") }], 1_240_000, today),
    ).toThrow("aujourd'hui ou plus tard");
    expect(() =>
      validatePromiseInstallments([{ amount: 2_000_000, date: d("2026-10-25") }], 1_240_000, today),
    ).toThrow("dépasse le solde dû (1 240 000 FCFA)");
    expect(() =>
      validatePromiseInstallments([{ amount: 500, date: d("2026-10-25") }], 1_240_000, today),
    ).toThrow(DomainError);
    expect(() =>
      validatePromiseInstallments([{ amount: 5_000, date: d("2026-12-18") }], 1_240_000, today),
    ).toThrow("60 jours");
    expect(() => validatePromiseInstallments([], 1_240_000, today)).toThrow(DomainError);
  });

  it("pause jusqu'au lendemain de la dernière échéance", () => {
    expect(
      promisePausedUntil([
        { amount: 1, date: d("2026-10-25") },
        { amount: 1, date: d("2026-11-05") },
      ]),
    ).toEqual(d("2026-11-06"));
    expect(promisePausedUntil([{ amount: 1, date: d("2026-10-25") }], 2)).toEqual(d("2026-10-28"));
  });

  it("KEPT / PARTIALLY_KEPT / BROKEN / PENDING", () => {
    const base = { amount: 600_000, promisedDate: d("2026-10-25") };
    expect(evaluatePromise({ ...base, paid: 600_000, today: d("2026-10-24") })).toBe("KEPT");
    expect(evaluatePromise({ ...base, paid: 0, today: d("2026-10-25") })).toBe("PENDING");
    expect(evaluatePromise({ ...base, paid: 0, today: d("2026-10-26") })).toBe("BROKEN");
    expect(evaluatePromise({ ...base, paid: 400_000, today: d("2026-10-26") })).toBe(
      "PARTIALLY_KEPT",
    );
    expect(evaluatePromise({ ...base, paid: 0, today: d("2026-10-26"), graceDays: 1 })).toBe(
      "PENDING",
    );
  });

  it("échéancier : répartit le payé par date", () => {
    const m = distributePaidAcrossInstallments(
      [
        { id: "p2", amount: 300_000, promisedDate: d("2026-11-05") },
        { id: "p1", amount: 300_000, promisedDate: d("2026-10-25") },
      ],
      400_000,
    );
    expect(m.get("p1")).toBe(300_000);
    expect(m.get("p2")).toBe(100_000);
  });
});

describe("caseLifecycle (RG-M09-03)", () => {
  const today = d("2026-10-20");
  const base = { minAmount: 2_000, reopenWithinDays: 30, today };

  it("ouvre, rattache, ferme", () => {
    expect(
      decideCaseAction({ ...base, activeCase: null, lastClosedCase: null, overdueDue: 185_000 }),
    ).toEqual({ action: "open" });
    expect(
      decideCaseAction({ ...base, activeCase: null, lastClosedCase: null, overdueDue: 1_500 }),
    ).toEqual({ action: "none" });
    const active = { id: "k1", status: "OPEN" as const, closedAt: null };
    expect(
      decideCaseAction({ ...base, activeCase: active, lastClosedCase: null, overdueDue: 412_000 }),
    ).toEqual({ action: "update", caseId: "k1" });
    expect(
      decideCaseAction({ ...base, activeCase: active, lastClosedCase: null, overdueDue: 0 }),
    ).toEqual({ action: "close", caseId: "k1", status: "CLOSED_PAID" });
    expect(
      decideCaseAction({
        ...base,
        activeCase: active,
        lastClosedCase: null,
        overdueDue: 0,
        onlyWrittenOffLeft: true,
      }),
    ).toMatchObject({ status: "CLOSED_WRITTEN_OFF" });
  });

  it("réouverture < 30 j, nouveau dossier ≥ 30 j", () => {
    const closed = (iso: string) => ({
      id: "old",
      status: "CLOSED_PAID" as const,
      closedAt: d(iso),
    });
    expect(
      decideCaseAction({
        ...base,
        activeCase: null,
        lastClosedCase: closed("2026-10-01"),
        overdueDue: 10_000,
      }),
    ).toEqual({ action: "reopen", caseId: "old" });
    expect(
      decideCaseAction({
        ...base,
        activeCase: null,
        lastClosedCase: closed("2026-09-20"),
        overdueDue: 10_000,
      }),
    ).toEqual({ action: "open" });
  });

  it("reprise après pause : ESCALATED restitué", () => {
    expect(statusAfterResume({ previousStatus: "OPEN", escalatedAt: null })).toBe("OPEN");
    expect(statusAfterResume({ previousStatus: "PROMISED", escalatedAt: null })).toBe("OPEN");
    expect(statusAfterResume({ previousStatus: "OPEN", escalatedAt: d("2026-10-01") })).toBe(
      "ESCALATED",
    );
    expect(statusAfterResume({ previousStatus: null, escalatedAt: null })).toBe("OPEN");
    expect(isUnreachable(2)).toBe(false);
    expect(isUnreachable(3)).toBe(true);
  });
});

describe("creditCheck (RG-M09-10)", () => {
  const base = {
    totalDue: 0,
    overdueDue: 0,
    maxDaysOverdue: 0,
    creditLimit: null,
    creditHold: false,
    caseEscalated: false,
  };
  it("OK", () => expect(creditCheck(base).level).toBe("OK"));
  it("SOTRA au-delà du plafond → BLOCK", () => {
    const r = creditCheck({
      ...base,
      totalDue: 1_240_000,
      overdueDue: 1_240_000,
      maxDaysOverdue: 38,
      creditLimit: 1_000_000,
    });
    expect(r.level).toBe("BLOCK");
    expect(r.reasons).toContain("OVER_LIMIT");
    expect(r.message).toBe(
      "Plafond de crédit dépassé : 1 240 000 FCFA dus (plafond 1 000 000 FCFA). Paiement comptant exigé ou dérogation d'un responsable.",
    );
  });
  it("Koné 12 j sans plafond → WARN", () => {
    const r = creditCheck({ ...base, totalDue: 185_000, overdueDue: 185_000, maxDaysOverdue: 12 });
    expect(r.level).toBe("WARN");
    expect(r.message).toBe(
      "Ce client a 185 000 FCFA impayés depuis 12 jours. Pensez à en parler à l'accueil.",
    );
  });
  it("chaque raison de blocage", () => {
    expect(creditCheck({ ...base, creditHold: true }).reasons).toEqual(["CREDIT_HOLD"]);
    expect(creditCheck({ ...base, overdueDue: 1, maxDaysOverdue: 61 }).reasons).toEqual([
      "OVERDUE_TOO_LONG",
    ]);
    expect(creditCheck({ ...base, overdueDue: 1, maxDaysOverdue: 60 }).level).toBe("WARN");
    expect(creditCheck({ ...base, caseEscalated: true }).reasons).toEqual(["ESCALATED"]);
    expect(
      creditCheck({ ...base, totalDue: 700_000, creditLimit: 1_000_000, additionalAmount: 100_000 })
        .reasons,
    ).toEqual(["NEAR_LIMIT"]);
    expect(
      creditCheck({ ...base, totalDue: 700_000, creditLimit: 1_000_000, additionalAmount: 400_000 })
        .level,
    ).toBe("BLOCK");
  });
});

describe("riskScore (RG-M09-12)", () => {
  it("SOTRA = 50 « Risqué »", () => {
    const r = riskScore({
      maxDaysOverdue: 52,
      overdueDue: 1_240_000,
      avgMonthlyBilled12m: 620_000,
      brokenPromises12m: 1,
      invoices12m: 10,
      onTimeRatio12m: 0.5,
      unreachable: false,
      openDispute: false,
    });
    expect(r.score).toBe(50);
    expect(r.label).toBe("RISKY");
    expect(r.components).toEqual({ A: 15.2, B: 20, C: 5, D: 10, E: 0 });
  });
  it("Traoré = 0", () => {
    expect(
      riskScore({
        maxDaysOverdue: 0,
        overdueDue: 0,
        avgMonthlyBilled12m: 100_000,
        brokenPromises12m: 0,
        invoices12m: 4,
        onTimeRatio12m: 1,
        unreachable: false,
        openDispute: false,
      }).score,
    ).toBe(0);
  });
  it("< 3 factures → D = 10 ; bornes", () => {
    expect(
      riskScore({
        maxDaysOverdue: 0,
        overdueDue: 0,
        avgMonthlyBilled12m: 0,
        brokenPromises12m: 0,
        invoices12m: 2,
        onTimeRatio12m: 1,
        unreachable: false,
        openDispute: false,
      }).components.D,
    ).toBe(10);
    const max = riskScore({
      maxDaysOverdue: 500,
      overdueDue: 10_000_000,
      avgMonthlyBilled12m: 0,
      brokenPromises12m: 9,
      invoices12m: 5,
      onTimeRatio12m: 0,
      unreachable: true,
      openDispute: true,
    });
    expect(max.score).toBe(100);
    expect(max.label).toBe("VERY_RISKY");
  });
});

describe("attributePayment (RG-M09-14)", () => {
  const at = (iso: string) => new Date(`${iso}T10:00:00.000Z`);
  it("relance dans la fenêtre, appel plus récent prioritaire, hors fenêtre spontané", () => {
    expect(
      attributePayment({
        receivedAt: at("2026-10-08"),
        reminders: [{ id: "r", at: at("2026-10-05") }],
        calls: [],
      }),
    ).toEqual({ source: "reminder", reminderId: "r" });
    expect(
      attributePayment({
        receivedAt: at("2026-10-08"),
        reminders: [{ id: "r", at: at("2026-10-05") }],
        calls: [{ id: "n", at: at("2026-10-07") }],
      }),
    ).toEqual({ source: "call", collectionNoteId: "n" });
    expect(
      attributePayment({
        receivedAt: at("2026-10-20"),
        reminders: [{ id: "r", at: at("2026-10-05") }],
        calls: [],
      }),
    ).toEqual({ source: "spontaneous" });
  });
});

describe("statement (RG-M09-15)", () => {
  it("solde d'ouverture, cumul, clôture", () => {
    const s = buildStatement(
      [
        {
          date: d("2025-12-01"),
          kind: "invoice",
          reference: "FAC-1",
          label: "Facture",
          amount: 100_000,
        },
        {
          date: d("2026-02-01"),
          kind: "invoice",
          reference: "FAC-2",
          label: "Facture",
          amount: 640_000,
        },
        {
          date: d("2026-03-01"),
          kind: "payment",
          reference: "REC-1",
          label: "Paiement Wave",
          amount: 300_000,
        },
        {
          date: d("2026-04-01"),
          kind: "credit_note",
          reference: "AV-1",
          label: "Avoir",
          amount: -40_000,
        },
        { date: d("2026-12-01"), kind: "invoice", reference: "FAC-9", label: "Facture", amount: 1 },
      ],
      d("2026-01-01"),
      d("2026-10-18"),
    );
    expect(s.openingBalance).toBe(100_000);
    expect(s.lines.map((l) => l.runningBalance)).toEqual([740_000, 440_000, 400_000]);
    expect(s.closingBalance).toBe(400_000);
    expect(s.totalDebit).toBe(640_000);
    expect(s.totalCredit).toBe(340_000);
    expect(statementFileName("SOTRA Logistique", d("2026-10-18"))).toBe(
      "Releve-SOTRA-Logistique-2026-10-18.pdf",
    );
  });
});

describe("stageEffectForStep (RG-M09-04)", () => {
  it("mappe les paliers", async () => {
    const { stageEffectForStep } = await import(".");
    expect(stageEffectForStep("J+3")).toEqual({ stage: 1, creditHold: false, escalate: false });
    expect(stageEffectForStep("J+30")?.creditHold).toBe(true);
    expect(stageEffectForStep("J+45")?.escalate).toBe(true);
    expect(stageEffectForStep("J+60")?.stage).toBe(5);
    expect(stageEffectForStep("PROMISE_BROKEN")).toBeNull();
  });
});
