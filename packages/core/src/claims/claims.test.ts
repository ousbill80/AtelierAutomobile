import { describe, expect, it } from "vitest";
import type { DraftInvoiceLine } from "../billing/lines";
import {
  avgDaysToPay,
  followUpConfigFrom,
  followUpStillDue,
  insurerAging,
  nextWorkingDay,
  planFollowUps,
  DEFAULT_FOLLOW_UP_CONFIG,
} from "./followUps";
import { buildClaimInvoices, splitClaim } from "./split";
import {
  assertInvoiceable,
  claimBlockers,
  claimPaymentStatus,
  claimTransition,
  missingDocuments,
  policyExpiredAtAccident,
} from "./status";

function line(partial: Partial<DraftInvoiceLine>): DraftInvoiceLine {
  return {
    type: "PART",
    productId: null,
    laborOperationId: null,
    description: "Ligne",
    quantity: 1,
    unitPrice: 0,
    discountRate: 0,
    vatRate: 18,
    payer: "INSURANCE",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: null,
    fixed: null,
    ...partial,
  };
}

// RG-M16-03 : pare-choc, phare, peinture, MO tôlerie 6 h × 12 000, MO peinture 5 h × 12 000.
const RG_M16_03 = [
  line({ description: "Pare-choc AV", unitPrice: 185_000 }),
  line({ description: "Phare AV gauche", unitPrice: 142_000 }),
  line({ description: "Peinture et ingrédients", type: "CONSUMABLE", unitPrice: 95_000 }),
  line({ description: "MO tôlerie", type: "LABOR", quantity: 6, unitPrice: 12_000 }),
  line({ description: "MO peinture", type: "LABOR", quantity: 5, unitPrice: 12_000 }),
];
const labels = {
  claimNumber: "SIN-YOP-2026-00031",
  insuredName: "Mme Traoré Aminata",
  policyNumber: "P-889",
};

describe("splitClaim (RG-M16-03)", () => {
  it("splits the PRD example: 553 720 insurer / 100 000 customer", () => {
    expect(splitClaim({ insuranceTotal: 653_720, deductible: 100_000 })).toMatchObject({
      insurerShare: 553_720,
      customerShare: 100_000,
      underDeductible: false,
      exceedsApproval: false,
    });
  });

  it("handles depreciation, a customer-borne gap and customer lines", () => {
    const s = splitClaim({
      insuranceTotal: 653_720,
      deductible: 100_000,
      depreciation: 30_000,
      gap: 53_720,
      customerTotal: 23_600,
      approvedAmount: 600_000,
    });
    expect(s.insurerShare).toBe(470_000);
    expect(s.customerShare).toBe(100_000 + 30_000 + 53_720 + 23_600);
    expect(s.exceedsApproval).toBe(false);
    expect(s.approvalGap).toBe(53_720);
  });

  it("flags an approval exceeded and a deductible above the repair", () => {
    expect(
      splitClaim({
        insuranceTotal: 653_720,
        deductible: 100_000,
        depreciation: 30_000,
        approvedAmount: 600_000,
      }).exceedsApproval,
    ).toBe(true);
    const under = splitClaim({ insuranceTotal: 80_000, deductible: 100_000 });
    expect(under).toMatchObject({ insurerShare: 0, customerShare: 80_000, underDeductible: true });
  });
});

describe("buildClaimInvoices (RG-M16-04/06)", () => {
  it("builds the two PRD invoices: insurer HT 469 254 / VAT 84 466 / 553 720, customer 100 000", () => {
    const res = buildClaimInvoices({
      insuranceLines: RG_M16_03,
      customerLines: [],
      deductible: 100_000,
      vatRate: 18,
      vatEnabled: true,
      labels,
    });
    expect(res.insuranceTotal).toBe(653_720);
    expect(res.insurer.totals).toMatchObject({
      subtotal: 469_254,
      vatTotal: 84_466,
      total: 553_720,
    });
    const franchise = res.insurer.lines.at(-1)!;
    expect(franchise).toMatchObject({ lineSubtotal: -84_746, lineVat: -15_254 });
    expect(franchise.description).toBe("Franchise à la charge de l'assuré — Mme Traoré Aminata");
    expect(res.customer.totals).toMatchObject({
      subtotal: 84_746,
      vatTotal: 15_254,
      total: 100_000,
    });
    expect(res.customer.lines[0]!.description).toBe(
      "Franchise sinistre SIN-YOP-2026-00031 (police n° P-889)",
    );
  });

  it("moves the VAT to the customer when vatPaidBy = CUSTOMER", () => {
    const res = buildClaimInvoices({
      insuranceLines: RG_M16_03,
      customerLines: [],
      deductible: 100_000,
      vatPaidBy: "CUSTOMER",
      vatRate: 18,
      vatEnabled: true,
      labels,
    });
    expect(res.insurer.totals).toMatchObject({ vatTotal: 0, total: 554_000 - 84_746 });
    // Franchise TTC 100 000 + TVA réparation 99 720 − TVA franchise 15 254.
    expect(res.customer.totals.total).toBe(100_000 + 99_720 - 15_254);
    expect(res.insurer.totals.total + res.customer.totals.total).toBe(653_720);
  });

  it("keeps insurer + customer = E + C on 200 random cases", () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };
    for (let i = 0; i < 200; i++) {
      const ins = Array.from({ length: 1 + rand(6) }, () =>
        line({
          unitPrice: 1_000 + rand(300_000),
          quantity: 1 + rand(4) + (rand(2) ? 0.5 : 0),
          discountRate: rand(3) === 0 ? rand(20) : 0,
        }),
      );
      const cust = Array.from({ length: rand(3) }, () =>
        line({ payer: "CUSTOMER", unitPrice: 500 + rand(50_000) }),
      );
      const E = buildClaimInvoices({
        insuranceLines: ins,
        customerLines: [],
        deductible: 0,
        vatRate: 18,
        vatEnabled: true,
        labels,
      }).insuranceTotal;
      const D = rand(Math.max(1, Math.floor(E / 3)));
      const V = rand(2) ? rand(Math.max(1, Math.floor(E / 5))) : 0;
      const res = buildClaimInvoices({
        insuranceLines: ins,
        customerLines: cust,
        deductible: D,
        depreciation: V,
        vatPaidBy: rand(4) === 0 ? "CUSTOMER" : "INSURANCE",
        vatRate: 18,
        vatEnabled: true,
        labels,
      });
      expect(res.insurer.totals.total + res.customer.totals.total).toBe(
        res.insuranceTotal + res.customerLinesTotal,
      );
    }
  });

  it("refuses a deductible above the repair (traiter comme réparation client)", () => {
    expect(() =>
      buildClaimInvoices({
        insuranceLines: [line({ unitPrice: 67_797 })],
        customerLines: [],
        deductible: 100_000,
        vatRate: 18,
        vatEnabled: true,
        labels,
      }),
    ).toThrow(/réparation client/);
  });
});

describe("claim status machine (§5)", () => {
  it("allows the main path and rejects invalid moves", () => {
    expect(claimTransition("OPENED", "schedule_expert")).toBe("EXPERT_SCHEDULED");
    expect(claimTransition("EXPERT_SCHEDULED", "send_estimate")).toBe("ESTIMATE_SENT");
    expect(claimTransition("ESTIMATE_SENT", "approve")).toBe("APPROVED");
    expect(claimTransition("APPROVED", "start_repair")).toBe("REPAIRING");
    expect(claimTransition("REPAIRING", "invoice")).toBe("INVOICED");
    expect(claimTransition("REPAIRING", "send_estimate")).toBe("ESTIMATE_SENT");
    expect(() => claimTransition("OPENED", "approve")).toThrow(
      "Action impossible : le dossier est « Ouvert ».",
    );
    expect(() => claimTransition("INVOICED", "cancel")).toThrow(/Facturé/);
    expect(() => claimTransition("APPROVED", "reject")).toThrow();
  });

  it("derives the payment status from both invoices (RG-M16-07)", () => {
    const insurer = {
      billTo: "INSURANCE",
      type: "INVOICE",
      status: "ISSUED",
      total: 553_720,
      balance: 553_720,
      amountPaid: 0,
    };
    const customer = {
      billTo: "CUSTOMER",
      type: "INVOICE",
      status: "ISSUED",
      total: 100_000,
      balance: 100_000,
      amountPaid: 0,
    };
    expect(claimPaymentStatus([])).toBeNull();
    expect(claimPaymentStatus([insurer, customer])).toBe("INVOICED");
    expect(
      claimPaymentStatus([
        insurer,
        { ...customer, status: "PAID", balance: 0, amountPaid: 100_000 },
      ]),
    ).toBe("PARTIALLY_PAID");
    expect(
      claimPaymentStatus([
        { ...insurer, balance: 13_720, amountPaid: 540_000, status: "PARTIALLY_PAID" },
        { ...customer, balance: 0, amountPaid: 100_000, status: "PAID" },
      ]),
    ).toBe("PARTIALLY_PAID");
    expect(
      claimPaymentStatus([
        { ...insurer, balance: 0, amountPaid: 553_720, status: "PAID" },
        { ...customer, balance: 0, amountPaid: 100_000, status: "PAID" },
      ]),
    ).toBe("PAID");
  });

  it("checks documents and invoiceability (RG-M16-09)", () => {
    expect(missingDocuments([], ["claim_report", "photo_damage"])).toEqual([
      "registration",
      "insurance_certificate",
    ]);
    expect(() =>
      assertInvoiceable({ claimNumber: null, attachmentKinds: ["expert_report"] }),
    ).toThrow(/n° de sinistre/);
    expect(() =>
      assertInvoiceable({ claimNumber: "A-1", attachmentKinds: ["photo_damage"] }),
    ).toThrow(/PV d'expertise/);
    expect(() =>
      assertInvoiceable({ claimNumber: "A-1", attachmentKinds: ["approval_letter"] }),
    ).not.toThrow();
  });

  it("raises blockers and the expired-policy warning", () => {
    const today = new Date("2026-10-20T00:00:00.000Z");
    expect(
      claimBlockers({
        status: "ESTIMATE_SENT",
        expertVisitAt: null,
        expertVisitedAt: null,
        estimateSentAt: new Date("2026-10-08T10:00:00.000Z"),
        repairOrderReady: true,
        customerBalance: 100_000,
        insurerInvoiceDueDate: new Date("2026-09-03T00:00:00.000Z"),
        insurerBalance: 553_720,
        today,
      }),
    ).toEqual([
      { code: "approval_waiting", days: 11 },
      { code: "ready_deductible_unpaid", amount: 100_000 },
      { code: "insurer_invoice_overdue", days: 47 },
    ]);
    expect(policyExpiredAtAccident(new Date("2026-09-30"), new Date("2026-10-02"))).toBe(true);
    expect(policyExpiredAtAccident(null, new Date("2026-10-02"))).toBe(false);
  });
});

describe("planFollowUps (RG-M16-08)", () => {
  const claim = {
    id: "c1",
    status: "ESTIMATE_SENT",
    expertVisitAt: null,
    expertVisitedAt: null,
    estimateSentAt: new Date("2026-10-01T09:00:00.000Z"),
  };

  it("plans the approval steps J+7, J+14, J+21 (escalation) when due", () => {
    const at = (d: string) =>
      planFollowUps({ claim, invoices: [], config: DEFAULT_FOLLOW_UP_CONFIG, today: new Date(d) });
    expect(at("2026-10-07T00:00:00Z")).toHaveLength(0);
    expect(at("2026-10-08T00:00:00Z").map((f) => f.stepKey)).toEqual(["J+7"]);
    const all = at("2026-10-23T00:00:00Z");
    expect(all.map((f) => f.stepKey)).toEqual(["J+7", "J+14", "J+21"]);
    expect(all[2]!.escalate).toBe(true);
    expect(all[0]!.dedupeKey).toBe("c1:approval:2026-10-01:J+7");
  });

  it("stops approval follow-ups once approved, and plans the expert reminder", () => {
    expect(
      planFollowUps({
        claim: { ...claim, status: "APPROVED" },
        invoices: [],
        config: DEFAULT_FOLLOW_UP_CONFIG,
        today: new Date("2026-11-30"),
      }),
    ).toHaveLength(0);
    const expert = planFollowUps({
      claim: {
        ...claim,
        status: "EXPERT_SCHEDULED",
        expertVisitAt: new Date("2026-10-14T09:00:00Z"),
      },
      invoices: [],
      config: DEFAULT_FOLLOW_UP_CONFIG,
      today: new Date("2026-10-16T00:00:00Z"),
    });
    expect(expert).toMatchObject([{ kind: "expert", stepKey: "J+2" }]);
  });

  it("plans payment steps J+0, J+15, J+30 then every 30 days, on working days, until paid", () => {
    const invoice = {
      id: "inv1",
      billTo: "INSURANCE",
      status: "ISSUED",
      balance: 553_720,
      dueDate: new Date("2026-12-19T00:00:00Z"), // samedi
    };
    const plan = planFollowUps({
      claim: { ...claim, status: "INVOICED" },
      invoices: [invoice],
      config: DEFAULT_FOLLOW_UP_CONFIG,
      today: new Date("2027-02-20T00:00:00Z"),
    });
    expect(plan.map((f) => f.stepKey)).toEqual(["J+0", "J+15", "J+30", "J+60"]);
    expect(plan[0]!.scheduledFor.toISOString().slice(0, 10)).toBe("2026-12-21");
    expect(
      planFollowUps({
        claim: { ...claim, status: "PAID" },
        invoices: [{ ...invoice, balance: 0, status: "PAID" }],
        config: DEFAULT_FOLLOW_UP_CONFIG,
        today: new Date("2027-02-20T00:00:00Z"),
      }),
    ).toHaveLength(0);
  });

  it("reads per-company configs and re-checks before sending", () => {
    expect(followUpConfigFrom({ approval: [5, 10], repeatEvery: 15 })).toMatchObject({
      approval: [5, 10],
      payment: [0, 15, 30],
      repeatEvery: 15,
    });
    expect(nextWorkingDay(new Date("2026-10-18T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-10-19",
    );
    expect(
      followUpStillDue({
        kind: "approval",
        claimStatus: "APPROVED",
        expertVisitedAt: null,
        invoiceBalance: null,
      }),
    ).toBe(false);
    expect(
      followUpStillDue({
        kind: "payment",
        claimStatus: "INVOICED",
        expertVisitedAt: null,
        invoiceBalance: 0,
      }),
    ).toBe(false);
  });
});

describe("insurer stats (RG-M16-11)", () => {
  it("computes the average days to pay: 74, 96, 118 → 96", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const plus = (n: number) => new Date(issued.getTime() + n * 86_400_000);
    expect(avgDaysToPay([74, 96, 118].map((n) => ({ issuedAt: issued, paidAt: plus(n) })))).toBe(
      96,
    );
    expect(avgDaysToPay([])).toBeNull();
  });

  it("ages the outstanding by issue date", () => {
    const today = new Date("2026-10-20T00:00:00Z");
    const ago = (n: number) => new Date(today.getTime() - n * 86_400_000);
    const res = insurerAging(
      [
        { balance: 100, issuedAt: ago(10) },
        { balance: 200, issuedAt: ago(45) },
        { balance: 300, issuedAt: ago(130) },
        { balance: 0, issuedAt: ago(200) },
      ],
      today,
    );
    expect(res).toEqual({
      outstanding: 600,
      aging: { b0_30: 100, b31_60: 200, b61_90: 0, b91_120: 0, b120p: 300 },
      oldestDays: 130,
    });
  });
});
