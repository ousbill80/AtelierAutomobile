import { describe, expect, it } from "vitest";
import { computeDocumentTotals, ttcToHt } from "../money/line";
import { amountInWords, toFrenchWords } from "../money/words";
import { allocatePayment } from "../receivables/allocation";
import {
  assertCanOpenSession,
  checkExpense,
  closeCash,
  denominationsTotal,
  expectedCash,
  isLateClose,
} from "./cash";
import {
  buildDepositDeduction,
  buildDepositLine,
  computeDraftTotals,
  planCreditNote,
  splitRepairOrderLines,
  type CreditableLine,
  type DraftInvoiceLine,
  type RepairOrderLineForInvoice,
} from "./lines";
import { checkPaymentInput, checkRefund, normalizePaymentReference } from "./payments";
import { billingSettingsFrom, DEFAULT_ACCOUNTS } from "./settings";
import { creditNoteEffect, deriveInvoiceStatus, planIssue } from "./status";
import {
  assertBalanced,
  cashEntries,
  receiptEntries,
  salesEntries,
  syscohadaCsv,
  type SalesDocument,
} from "./syscohada";

const RG_M08_06 = [
  { quantity: 1, unitPrice: 15_000, discountRate: 0, vatRate: 18 },
  { quantity: 4.5, unitPrice: 6_350, discountRate: 0, vatRate: 18 },
  { quantity: 1, unitPrice: 4_750, discountRate: 10, vatRate: 18 },
  { quantity: 1, unitPrice: 37_900, discountRate: 5, vatRate: 18 },
  { quantity: 1.5, unitPrice: 15_000, discountRate: 0, vatRate: 18 },
  { quantity: 0.5, unitPrice: 5_900, discountRate: 0, vatRate: 18 },
];

function draft(partial: Partial<DraftInvoiceLine>): DraftInvoiceLine {
  return {
    type: "LABOR",
    productId: null,
    laborOperationId: null,
    description: "Ligne",
    quantity: 1,
    unitPrice: 0,
    discountRate: 0,
    vatRate: 18,
    payer: "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: null,
    fixed: null,
    ...partial,
  };
}

describe("computeDocumentTotals (RG-M08-05/06)", () => {
  it("reproduces the RG-M08-06 table exactly", () => {
    const { lines, totals } = computeDocumentTotals(RG_M08_06);
    expect(lines.map((l) => l.lineTotal)).toEqual([17_700, 33_719, 5_045, 42_486, 26_550, 3_481]);
    expect(totals.subtotal).toBe(109_305);
    expect(totals.vatTotal).toBe(19_676);
    expect(totals.total).toBe(128_981);
    expect(totals.grossSubtotal).toBe(111_675);
    expect(totals.discountTotal).toBe(2_370);
  });

  it("zeroes the VAT when the organisation is not subject to VAT (RG-M08-08)", () => {
    const { totals } = computeDocumentTotals(RG_M08_06, { vatEnabled: false });
    expect(totals.vatTotal).toBe(0);
    expect(totals.total).toBe(109_305);
  });

  it("computes the VAT on the sum per rate in `total` mode and keeps Σ line VAT = VAT total", () => {
    const { lines, totals } = computeDocumentTotals(RG_M08_06, { vatRounding: "total" });
    // 109 305 × 18 % = 19 674,9 → 19 675 (au lieu de 19 676 ligne à ligne).
    expect(totals.vatTotal).toBe(19_675);
    expect(lines.reduce((s, l) => s + l.lineVat, 0)).toBe(19_675);
    expect(totals.total).toBe(109_305 + 19_675);
  });

  it("handles negative quantities symmetrically (credit notes)", () => {
    const { totals } = computeDocumentTotals([{ quantity: -4.5, unitPrice: 6_350, vatRate: 18 }]);
    expect(totals.subtotal).toBe(-28_575);
    expect(totals.vatTotal).toBe(-5_144);
    expect(totals.total).toBe(-33_719);
  });

  it("keeps fixed amounts untouched", () => {
    const { totals } = computeDocumentTotals([
      {
        quantity: 1,
        unitPrice: 42_373,
        vatRate: 18,
        fixed: { lineSubtotal: 42_373, lineVat: 7_627 },
      },
    ]);
    expect(totals.total).toBe(50_000);
  });
});

describe("ttcToHt (RG-M08-07)", () => {
  it("splits 50 000 and 100 000 TTC", () => {
    expect(ttcToHt(50_000, 18)).toEqual({ ht: 42_373, vat: 7_627 });
    expect(ttcToHt(100_000, 18)).toEqual({ ht: 84_746, vat: 15_254 });
  });
});

describe("toFrenchWords", () => {
  it.each([
    [185_000, "cent quatre-vingt-cinq mille"],
    [1_080_080, "un million quatre-vingt mille quatre-vingts"],
    [71, "soixante et onze"],
    [80, "quatre-vingts"],
    [91, "quatre-vingt-onze"],
    [200, "deux cents"],
    [1_000_000, "un million"],
    [21, "vingt et un"],
    [201, "deux cent un"],
    [200_000, "deux cent mille"],
    [2_000_000, "deux millions"],
    [0, "zéro"],
    [1_000, "mille"],
    [128_981, "cent vingt-huit mille neuf cent quatre-vingt-un"],
  ])("%i → %s", (n, words) => {
    expect(toFrenchWords(n)).toBe(words);
  });

  it("formats the legal mention", () => {
    expect(amountInWords(185_000)).toBe("Cent quatre-vingt-cinq mille francs CFA");
  });
});

describe("splitRepairOrderLines (US-M08-01)", () => {
  const base: RepairOrderLineForInvoice = {
    id: "l",
    type: "LABOR",
    productId: null,
    laborOperationId: null,
    description: "MO",
    quantity: 1,
    unitPrice: 15_000,
    discountRate: 0,
    vatRate: 18,
    status: "DONE",
    approval: "APPROVED",
    payer: "CUSTOMER",
    isCustomerSupplied: false,
    costPrice: null,
    sortOrder: 0,
  };

  it("keeps billable customer lines, routes insurance lines, drops warranty/internal/cancelled/declined", () => {
    const res = splitRepairOrderLines([
      { ...base, id: "a", sortOrder: 2 },
      { ...base, id: "b", sortOrder: 1, payer: "INSURANCE" },
      { ...base, id: "c", payer: "WARRANTY" },
      { ...base, id: "d", payer: "INTERNAL" },
      { ...base, id: "e", status: "CANCELLED" },
      { ...base, id: "f", approval: "DECLINED" },
      {
        ...base,
        id: "g",
        sortOrder: 0,
        type: "PART",
        productId: "p",
        productAverageCost: 30_000,
        quantity: 2,
      },
    ]);
    expect(res.customer.map((l) => l.repairOrderLineId)).toEqual(["g", "a"]);
    expect(res.insurance.map((l) => l.repairOrderLineId)).toEqual(["b"]);
    expect(res.notBilled).toBe(2);
    expect(res.customer[0]!.unitCost).toBe(30_000);
  });

  it("bills customer-supplied parts at 0 with the legal mention", () => {
    const res = splitRepairOrderLines([
      {
        ...base,
        type: "PART",
        isCustomerSupplied: true,
        unitPrice: 50_000,
        description: "Amortisseur",
      },
    ]);
    expect(res.customer[0]!.unitPrice).toBe(0);
    expect(res.customer[0]!.description).toContain("Pièce fournie par le client");
  });
});

describe("computeDraftTotals", () => {
  it("freezes the cost for the margin (M12)", () => {
    const res = computeDraftTotals(
      [draft({ type: "PART", quantity: 4.5, unitPrice: 6_350, unitCost: 4_100 })],
      { vatEnabled: true },
    );
    expect(res.costTotal).toBe(18_450);
    expect(res.lines[0]!.lineTotal).toBe(33_719);
  });
});

describe("deposits (US-M08-03)", () => {
  it("builds the 50 000 TTC deposit line", () => {
    const line = buildDepositLine({
      reference: "DEV-YOP-2026-00017",
      amountTtc: 50_000,
      vatRate: 18,
    });
    expect(line.description).toBe("Acompte sur devis DEV-YOP-2026-00017");
    const { totals } = computeDraftTotals([line], { vatEnabled: true });
    expect(totals).toMatchObject({ subtotal: 42_373, vatTotal: 7_627, total: 50_000 });
  });

  const deposit = {
    id: "dep",
    number: "FAC-2026-000398",
    type: "DEPOSIT",
    status: "PAID",
    customerId: "c1",
    subtotal: 42_373,
    vatTotal: 7_627,
    vatRate: 18,
    alreadyDeducted: false,
  };

  it("deducts a paid deposit once: 653 720 − 50 000 = 603 720", () => {
    const deduction = buildDepositDeduction(deposit, "c1");
    expect(deduction.description).toBe("Déduction acompte FAC-2026-000398");
    // Lignes du devis : 554 000 HT + TVA 18 % = 653 720 TTC.
    const { totals } = computeDraftTotals([draft({ unitPrice: 554_000 }), deduction], {
      vatEnabled: true,
    });
    expect(totals.total).toBe(603_720);
    expect(totals.subtotal).toBe(554_000 - 42_373);
    expect(totals.vatTotal).toBe(99_720 - 7_627);
  });

  it("refuses an unpaid, already deducted or foreign deposit", () => {
    expect(() => buildDepositDeduction({ ...deposit, status: "ISSUED" }, "c1")).toThrow(
      /pas encore payé/,
    );
    expect(() => buildDepositDeduction({ ...deposit, alreadyDeducted: true }, "c1")).toThrow(
      /déjà été déduit/,
    );
    expect(() => buildDepositDeduction(deposit, "c2")).toThrow(/autre client/);
  });
});

describe("planCreditNote (US-M08-04, RG-M08-12)", () => {
  const lines: CreditableLine[] = computeDraftTotals(
    RG_M08_06.map((l, i) => draft({ ...l, description: `L${i}` })),
    { vatEnabled: true },
  ).lines.map((l, i) => ({ ...l, id: `line-${i}` }));
  const invoice = { total: 128_981, creditedAmount: 0, lines };

  it("credits the whole invoice with mirrored amounts", () => {
    const plan = planCreditNote({ invoice, selection: "FULL", vatEnabled: true });
    expect(plan.totals.total).toBe(-128_981);
    expect(plan.amount).toBe(128_981);
    expect(plan.isFull).toBe(true);
  });

  it("credits a partial quantity with negative amounts", () => {
    const plan = planCreditNote({
      invoice,
      selection: [{ invoiceLineId: "line-1", quantity: 2 }],
      vatEnabled: true,
    });
    // 2 × 6 350 = 12 700 HT, TVA 2 286.
    expect(plan.totals.total).toBe(-14_986);
    expect(plan.isFull).toBe(false);
  });

  it("refuses to exceed the remaining amount", () => {
    expect(() =>
      planCreditNote({
        invoice: { ...invoice, creditedAmount: 120_000 },
        selection: [{ invoiceLineId: "line-0", quantity: 1 }],
        vatEnabled: true,
      }),
    ).toThrow("L'avoir ne peut pas dépasser 8 981 FCFA.");
    expect(() =>
      planCreditNote({
        invoice: { ...invoice, creditedAmount: 1 },
        selection: "FULL",
        vatEnabled: true,
      }),
    ).toThrow(/avoir partiel existe déjà/);
    expect(() =>
      planCreditNote({
        invoice,
        selection: [{ invoiceLineId: "line-0", quantity: 2 }],
        vatEnabled: true,
      }),
    ).toThrow(/Quantité à créditer invalide/);
  });
});

describe("deriveInvoiceStatus (RG-M08-10/11)", () => {
  const today = new Date("2026-10-19T00:00:00.000Z");
  const base = {
    status: "ISSUED",
    total: 185_000,
    amountPaid: 0,
    creditedAmount: 0,
    dueDate: today,
    today,
  };

  it("derives ISSUED, PARTIALLY_PAID and PAID", () => {
    expect(deriveInvoiceStatus(base)).toEqual({
      amountPaid: 0,
      balance: 185_000,
      status: "ISSUED",
    });
    expect(deriveInvoiceStatus({ ...base, amountPaid: 100_000 })).toEqual({
      amountPaid: 100_000,
      balance: 85_000,
      status: "PARTIALLY_PAID",
    });
    expect(deriveInvoiceStatus({ ...base, amountPaid: 185_000 }).status).toBe("PAID");
  });

  it("keeps OVERDUE while a balance remains past the due date", () => {
    const past = new Date("2026-10-10T00:00:00.000Z");
    expect(deriveInvoiceStatus({ ...base, dueDate: past, amountPaid: 100_000 }).status).toBe(
      "OVERDUE",
    );
  });

  it("goes back from PAID when a cheque bounces (allocation removed)", () => {
    expect(deriveInvoiceStatus({ ...base, status: "PAID", amountPaid: 0 }).status).toBe("ISSUED");
  });

  it("subtracts partial credit notes and preserves explicit statuses", () => {
    expect(deriveInvoiceStatus({ ...base, creditedAmount: 85_000 })).toMatchObject({
      balance: 100_000,
      status: "PARTIALLY_PAID",
    });
    expect(deriveInvoiceStatus({ ...base, status: "DISPUTED", amountPaid: 185_000 }).status).toBe(
      "DISPUTED",
    );
    expect(deriveInvoiceStatus({ ...base, total: 0 }).status).toBe("PAID");
  });
});

describe("creditNoteEffect", () => {
  it("creates a customer credit when the invoice was already paid", () => {
    expect(
      creditNoteEffect({ total: 185_000, amountPaid: 185_000, creditedAmount: 0, amount: 50_000 }),
    ).toEqual({ creditedAmount: 50_000, customerCredit: 50_000 });
    expect(
      creditNoteEffect({ total: 185_000, amountPaid: 100_000, creditedAmount: 0, amount: 185_000 }),
    ).toEqual({ creditedAmount: 185_000, customerCredit: 100_000 });
    expect(
      creditNoteEffect({ total: 185_000, amountPaid: 0, creditedAmount: 0, amount: 50_000 }),
    ).toEqual({ creditedAmount: 50_000, customerCredit: 0 });
  });
});

describe("planIssue (RG-M08-01/03/04)", () => {
  const organization = {
    legalName: "Garage Yopougon SARL",
    ncc: "1912345A",
    rccm: "CI-ABJ-2019-B-12345",
    address: "Yopougon",
    phone: "+2252722000000",
    taxRegime: "RNI",
  };
  const now = new Date("2026-12-31T23:30:00.000Z");
  const input = {
    invoice: { status: "DRAFT", type: "INVOICE", total: 185_000, lineCount: 2 },
    organization,
    now,
    timeZone: "Africa/Abidjan",
    lastIssuedAt: null,
    paymentTermsDays: 30,
    fneMode: "manual" as const,
  };

  it("computes the due date and the fiscal year in the organisation time zone", () => {
    const plan = planIssue(input);
    expect(plan.dueDate.toISOString().slice(0, 10)).toBe("2027-01-30");
    expect(plan.year).toBe(2026);
    expect(plan.docType).toBe("FAC");
    expect(plan.fneStatus).toBe("PENDING");
    expect(
      planIssue({ ...input, paymentTermsDays: 0 })
        .dueDate.toISOString()
        .slice(0, 10),
    ).toBe("2026-12-31");
    expect(planIssue({ ...input, fneMode: "disabled" }).fneStatus).toBe("NOT_REQUIRED");
    expect(
      planIssue({ ...input, invoice: { ...input.invoice, type: "CREDIT_NOTE", total: -10 } })
        .docType,
    ).toBe("AV");
  });

  it("blocks issuance without RCCM/NCC, lines, or with backdating", () => {
    expect(() => planIssue({ ...input, organization: { ...organization, ncc: null } })).toThrow(
      /NCC/,
    );
    expect(() => planIssue({ ...input, invoice: { ...input.invoice, lineCount: 0 } })).toThrow(
      /au moins une ligne/,
    );
    expect(() =>
      planIssue({ ...input, lastIssuedAt: new Date("2027-01-01T00:00:00.000Z") }),
    ).toThrow(/datée avant/);
    expect(() => planIssue({ ...input, invoice: { ...input.invoice, status: "ISSUED" } })).toThrow(
      /déjà émise/,
    );
  });
});

describe("allocatePayment (RG-M08-19)", () => {
  const inv = (id: string, balance: number, due: string) => ({
    id,
    status: "ISSUED",
    total: balance,
    amountPaid: 0,
    balance,
    dueDate: new Date(due),
    issuedAt: new Date(due),
  });
  const sotra = [
    inv("c", 590_000, "2026-09-30"),
    inv("a", 240_000, "2026-08-31"),
    inv("b", 410_000, "2026-09-15"),
  ];

  it("settles the oldest first (SOTRA: 240 000 + 410 000 + 150 000)", () => {
    expect(allocatePayment({ amount: 800_000, invoices: sotra })).toEqual({
      allocations: [
        { invoiceId: "a", amount: 240_000 },
        { invoiceId: "b", amount: 410_000 },
        { invoiceId: "c", amount: 150_000 },
      ],
      unallocated: 0,
    });
  });

  it("puts the current invoice first", () => {
    const res = allocatePayment({ amount: 600_000, invoices: sotra, currentInvoiceId: "c" });
    expect(res.allocations[0]).toEqual({ invoiceId: "c", amount: 590_000 });
  });

  it("keeps an overpayment unallocated (85 000 due, 90 000 paid)", () => {
    expect(
      allocatePayment({ amount: 90_000, invoices: [inv("x", 85_000, "2026-10-19")] }).unallocated,
    ).toBe(5_000);
  });
});

describe("payments (RG-M08-18/20/22/26)", () => {
  it("requires a reference for mobile money, cheque and transfer", () => {
    expect(() =>
      checkPaymentInput({ method: "WAVE", amount: 1, reference: " ", hasOpenCashSession: true }),
    ).toThrow("Indiquez l'identifiant de la transaction Wave.");
    expect(() =>
      checkPaymentInput({ method: "CHEQUE", amount: 1, reference: null, hasOpenCashSession: true }),
    ).toThrow(/chèque/);
    expect(
      checkPaymentInput({
        method: "CHEQUE",
        amount: 1,
        reference: "123 SGCI",
        hasOpenCashSession: false,
      }),
    ).toEqual({ reference: "123 SGCI", status: "PENDING" });
  });

  it("requires an open cash session for cash", () => {
    expect(() =>
      checkPaymentInput({
        method: "CASH",
        amount: 100_000,
        reference: null,
        hasOpenCashSession: false,
      }),
    ).toThrow("Ouvrez la caisse pour encaisser en espèces.");
    expect(
      checkPaymentInput({
        method: "CASH",
        amount: 100_000,
        reference: null,
        hasOpenCashSession: true,
      }).status,
    ).toBe("CONFIRMED");
  });

  it("normalises references and caps refunds", () => {
    expect(normalizePaymentReference(" t_8f2a  9 ")).toBe("T_8F2A 9");
    expect(() =>
      checkRefund({
        amount: 6_000,
        available: 5_000,
        method: "CASH",
        reference: null,
        hasOpenCashSession: true,
      }),
    ).toThrow("Le remboursement ne peut pas dépasser 5 000 FCFA disponibles.");
  });
});

describe("cash (RG-M08-27/28/29/30)", () => {
  it("computes the RG-M08-28 example: 612 500 expected, −2 500 counted difference", () => {
    const expected = expectedCash({
      openingFloat: 50_000,
      cashPayments: 615_000,
      expenses: 12_500,
      cashRefunds: 0,
      drops: 40_000,
    });
    expect(expected).toBe(612_500);
    expect(() =>
      closeCash({ expected, counted: 610_000, notes: "", varianceAlert: 5_000 }),
    ).toThrow(/commentaire est obligatoire/);
    expect(
      closeCash({ expected, counted: 610_000, notes: "Monnaie", varianceAlert: 5_000 }),
    ).toEqual({
      difference: -2_500,
      alert: false,
    });
    expect(
      closeCash({ expected, counted: 600_000, notes: "Manque", varianceAlert: 5_000 }).alert,
    ).toBe(true);
  });

  it("totals the denominations", () => {
    expect(denominationsTotal({ "10000": 42, "5000": 30, "500": 5 })).toBe(572_500);
    expect(() => denominationsTotal({ "3000": 1 })).toThrow(/Coupure inconnue/);
  });

  it("blocks a second session and a stale one", () => {
    const now = new Date("2026-10-19T09:00:00.000Z");
    const common = { membershipId: "m1", openingFloat: 50_000, now, timeZone: "Africa/Abidjan" };
    expect(() =>
      assertCanOpenSession({
        ...common,
        oneSessionPerSite: true,
        openSessions: [{ id: "s", openedById: "m2", openedAt: new Date("2026-10-19T07:00:00Z") }],
      }),
    ).toThrow("Une caisse est déjà ouverte sur ce site.");
    expect(() =>
      assertCanOpenSession({
        ...common,
        oneSessionPerSite: false,
        openSessions: [{ id: "s", openedById: "m2", openedAt: new Date("2026-10-18T07:00:00Z") }],
      }),
    ).toThrow(/jour précédent/);
    expect(() =>
      assertCanOpenSession({
        ...common,
        oneSessionPerSite: false,
        openSessions: [{ id: "s", openedById: "m2", openedAt: new Date("2026-10-19T07:00:00Z") }],
      }),
    ).not.toThrow();
  });

  it("flags late closes", () => {
    const opened = new Date("2026-10-19T07:00:00.000Z");
    expect(isLateClose(opened, new Date("2026-10-19T18:00:00.000Z"), "Africa/Abidjan")).toBe(false);
    expect(isLateClose(opened, new Date("2026-10-19T23:10:00.000Z"), "Africa/Abidjan")).toBe(true);
    expect(isLateClose(opened, new Date("2026-10-20T08:00:00.000Z"), "Africa/Abidjan")).toBe(true);
  });

  it("requires approval above the expense threshold", () => {
    const base = {
      category: "Carburant",
      description: "Essai routier",
      categories: ["Carburant"],
      approvalThreshold: 25_000,
      canApprove: false,
      sessionClosed: false,
    };
    expect(checkExpense({ ...base, amount: 12_500 })).toEqual({ approved: false });
    expect(() => checkExpense({ ...base, amount: 30_000 })).toThrow(/validée par le gérant/);
    expect(checkExpense({ ...base, amount: 30_000, canApprove: true })).toEqual({ approved: true });
    expect(() => checkExpense({ ...base, amount: 1, sessionClosed: true })).toThrow(/clôturée/);
  });
});

describe("SYSCOHADA (RG-M08-31)", () => {
  const accounts = DEFAULT_ACCOUNTS;
  const invoice: SalesDocument = {
    number: "FAC-2026-000412",
    date: "19/10/2026",
    type: "INVOICE",
    customerName: "Kouassi Jean-Marc",
    customerAccount: "C0001",
    lines: [
      { type: "LABOR", lineSubtotal: 37_500 },
      { type: "PART", lineSubtotal: 71_805 },
    ],
    vatTotal: 19_676,
    total: 128_981,
  };

  it("writes a balanced sales entry and the exact reverse for a credit note", () => {
    const entries = salesEntries([invoice], accounts);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ account: "411", debit: 128_981, credit: 0 });
    expect(entries.find((e) => e.account === "706")).toMatchObject({ credit: 37_500 });
    expect(entries.find((e) => e.account === "701")).toMatchObject({ credit: 71_805 });
    expect(entries.find((e) => e.account === "4431")).toMatchObject({ credit: 19_676 });
    expect(assertBalanced(entries)).toEqual({ debit: 128_981, credit: 128_981 });

    const credit = salesEntries(
      [
        {
          ...invoice,
          number: "AV-2026-000014",
          type: "CREDIT_NOTE",
          reference: "FAC-2026-000412",
          lines: invoice.lines.map((l) => ({ ...l, lineSubtotal: -l.lineSubtotal })),
          vatTotal: -19_676,
          total: -128_981,
        },
      ],
      accounts,
    );
    expect(credit[0]).toMatchObject({ account: "411", debit: 0, credit: 128_981 });
    expect(credit.find((e) => e.account === "4431")).toMatchObject({ debit: 19_676 });
    assertBalanced(credit);
  });

  it("writes receipts, refunds, expenses and bank drops", () => {
    const en = receiptEntries(
      [
        {
          piece: "REC-2026-000310",
          date: "19/10/2026",
          method: "CASH",
          customerName: "K",
          customerAccount: "C1",
          amount: 100_000,
        },
        {
          piece: "REC-2026-000311",
          date: "19/10/2026",
          method: "WAVE",
          customerName: "K",
          customerAccount: "C1",
          amount: 85_000,
        },
        {
          piece: "RMB-1",
          date: "19/10/2026",
          method: "CASH",
          customerName: "K",
          customerAccount: "C1",
          amount: 5_000,
          isRefund: true,
        },
      ],
      accounts,
    );
    expect(en[0]).toMatchObject({ account: "571", debit: 100_000 });
    expect(en[2]).toMatchObject({ account: "585", debit: 85_000 });
    expect(en[4]).toMatchObject({ account: "571", credit: 5_000 });
    const ca = cashEntries(
      [
        {
          piece: "DEP-1",
          date: "19/10/2026",
          category: "Carburant",
          description: "Essai",
          amount: 12_500,
        },
      ],
      [
        { piece: "VER-1", date: "19/10/2026", amount: 40_000, destination: "bank" },
        { piece: "VER-2", date: "19/10/2026", amount: 10_000, destination: "safe" },
      ],
      accounts,
    );
    expect(ca).toHaveLength(4);
    assertBalanced([...en, ...ca]);
  });

  it("exports a `;` CSV with BOM and refuses an unbalanced entry", () => {
    const csv = syscohadaCsv(salesEntries([invoice], accounts));
    expect(
      csv.startsWith(
        "\uFEFFJournal;Date;N° pièce;Compte;Compte tiers;Libellé;Débit;Crédit;Référence",
      ),
    ).toBe(true);
    expect(csv).toContain("VT;19/10/2026;FAC-2026-000412;411;C0001;");
    expect(() =>
      syscohadaCsv([
        {
          journal: "VT",
          date: "",
          piece: "X",
          account: "411",
          thirdParty: "",
          label: "",
          debit: 1,
          credit: 0,
          reference: "",
        },
      ]),
    ).toThrow(/déséquilibrée/);
  });
});

describe("billingSettingsFrom", () => {
  it("applies defaults and overrides", () => {
    const s = billingSettingsFrom({
      cash: { varianceAlert: 2_000 },
      billing: { vatRounding: "total" },
    });
    expect(s.varianceAlert).toBe(2_000);
    expect(s.expenseApproval).toBe(25_000);
    expect(s.vatRounding).toBe("total");
    expect(s.accounts.customers).toBe("411");
  });
});
