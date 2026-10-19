import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createContext } from "../context";
import { setReceivablesClock } from "../receivables/helpers";
import { setRepairOrdersClock } from "../repairOrders/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

vi.mock("../messaging/queue", () => ({ enqueueMessageSendJob: vi.fn(async () => undefined) }));

const callerFactory = createCallerFactory(appRouter);
type Caller = ReturnType<typeof callerFactory>;
type Role = "OWNER" | "MANAGER" | "ADVISOR" | "CASHIER" | "ACCOUNTANT";

// Horloge figée (jamais l'heure réelle) : 19/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-19T10:00:00.000Z");

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.77" },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

const users: string[] = [];

async function member(organizationId: string, role: Role) {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(2).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.com`,
    },
  });
  users.push(user.id);
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role, siteIds: [] },
  });
  const token = randomBytes(32).toString("hex");
  await adminDb.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
      activeOrganizationId: organizationId,
      isPinSession: false,
    },
  });
  return { membershipId: membership.id, caller: callerFactory(await contextFor(token)) };
}

const IDENTITY = {
  legalName: "Garage Yopougon SARL",
  rccm: "CI-ABJ-2019-B-12345",
  ncc: "1912345A",
  address: "Yopougon, Abidjan",
  phone: "+2252722000000",
  taxRegime: "RNI" as const,
};

describe("M08 — facturation, paiements, caisse", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let siteA: { id: string };
  let owner: Caller;
  let advisor: Caller;
  let cashier: Caller;
  let accountant: Caller;
  let callerB: Caller;
  let kouassi: { id: string };
  let sotra: { id: string };
  let vehicle: { id: string };
  let oil: { id: string };
  let filter: { id: string };

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Facturation A", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage Facturation B", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgIds.push(orgA.id, orgB.id);
    siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = (await member(orgA.id, "OWNER")).caller;
    advisor = (await member(orgA.id, "ADVISOR")).caller;
    cashier = (await member(orgA.id, "CASHIER")).caller;
    accountant = (await member(orgA.id, "ACCOUNTANT")).caller;
    callerB = (await member(orgB.id, "OWNER")).caller;
    kouassi = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Kouassi Jean-Marc", phone: "+2250707070707" },
    });
    sotra = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        type: "COMPANY",
        displayName: "SOTRA Logistique SARL",
        paymentTermsDays: 30,
      },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: kouassi.id,
        plate: "2547 GH 01",
        plateCompact: "2547GH01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    oil = await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "HUILE-5W30",
        name: "Huile 5W30 (L)",
        unit: "litre",
        quantityScale: 10,
        salePrice: 6_350,
        averageCost: 4_100,
      },
    });
    filter = await adminDb.product.create({
      data: {
        organizationId: orgA.id,
        sku: "FH-01",
        name: "Filtre à huile",
        salePrice: 4_750,
        averageCost: 3_000,
      },
    });
    await adminDb.stockLevel.create({
      data: { organizationId: orgA.id, siteId: siteA.id, productId: oil.id, onHand: 200 },
    });
    await adminDb.stockLevel.create({
      data: { organizationId: orgA.id, siteId: siteA.id, productId: filter.id, onHand: 10 },
    });
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.paymentAttribution.deleteMany({ where });
    await adminDb.refund.deleteMany({ where });
    await adminDb.paymentAllocation.deleteMany({ where });
    await adminDb.customerCredit.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.cashDrop.deleteMany({ where });
    await adminDb.expense.deleteMany({ where });
    await adminDb.cashSession.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.stockMovement.deleteMany({ where });
    await adminDb.stockReservation.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where: { ...where, depositInvoiceId: { not: null } } });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where: { ...where, creditedInvoiceId: { not: null } } });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.collectionCase.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.stockLevel.deleteMany({ where });
    await adminDb.product.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.notification.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  async function readyOrder(status: "READY" | "DELIVERED" = "READY") {
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: `OR-YOP-2026-${randomBytes(3).toString("hex")}`,
        customerId: kouassi.id,
        vehicleId: vehicle.id,
        status,
        mileageIn: 84_500,
      },
    });
    const line = (data: Record<string, unknown>) =>
      adminDb.repairOrderLine.create({
        data: {
          organizationId: orgA.id,
          repairOrderId: order.id,
          type: "LABOR",
          description: "MO",
          quantity: 1,
          unitPrice: 15_000,
          vatRate: 18,
          status: "DONE",
          approval: "APPROVED",
          ...data,
        } as never,
      });
    await line({ description: "MO Vidange moteur", sortOrder: 0 });
    await line({
      type: "PART",
      productId: oil.id,
      description: "Huile 5W30 (L)",
      quantity: 4.5,
      unitPrice: 6_350,
      sortOrder: 1,
    });
    await line({
      type: "PART",
      productId: filter.id,
      description: "Filtre à huile",
      unitPrice: 4_750,
      discountRate: 10,
      sortOrder: 2,
    });
    await line({ description: "Contrôle garantie", payer: "WARRANTY", sortOrder: 3 });
    await line({
      description: "Amortisseur refusé",
      approval: "DECLINED",
      unitPrice: 45_000,
      sortOrder: 4,
    });
    await line({
      description: "Carrosserie assurance",
      payer: "INSURANCE",
      unitPrice: 100_000,
      sortOrder: 5,
    });
    return order;
  }

  let invoiceId: string;

  it("US-M08-01 : « Facturer » un OR READY → brouillon client + brouillon assurance", async () => {
    const order = await readyOrder();
    const res = await advisor.invoice.createFromRepairOrder({ repairOrderId: order.id });
    expect(res.customerInvoice).toMatchObject({
      status: "DRAFT",
      number: null,
      mileage: 84_500,
      // 17 700 + 33 719 + 5 045 (RG-M08-06)
      total: 56_464,
    });
    expect(res.insuranceInvoice).toMatchObject({ billTo: "INSURANCE", total: 118_000 });
    invoiceId = res.customerInvoice!.id;
    // Idempotent : un second clic renvoie le même brouillon.
    const again = await advisor.invoice.createFromRepairOrder({ repairOrderId: order.id });
    expect(again.customerInvoice!.id).toBe(invoiceId);
    const detail = await advisor.invoice.get({ id: invoiceId });
    expect(detail.lines.map((l) => l.description)).toEqual([
      "MO Vidange moteur",
      "Huile 5W30 (L)",
      "Filtre à huile",
    ]);
  });

  it("émission : FAC sans trou, échéance, FNE en attente, stock sorti, OR toujours READY", async () => {
    const issued = await advisor.invoice.issue({ id: invoiceId });
    expect(issued).toMatchObject({
      number: "FAC-2026-000001",
      status: "ISSUED",
      fneStatus: "PENDING",
      balance: 56_464,
      costTotal: 4.5 * 4_100 + 3_000,
    });
    expect(issued.dueDate!.toISOString().slice(0, 10)).toBe("2026-10-19");
    const movements = await adminDb.stockMovement.findMany({
      where: { organizationId: orgA.id, reason: "auto à la facturation" },
    });
    expect(movements.map((m) => m.quantity).sort((a, b) => a - b)).toEqual([-45, -1]);
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgA.id, type: "invoice.issued" },
    });
    expect(event?.payload).toMatchObject({ invoiceId, number: "FAC-2026-000001" });
    await expect(advisor.invoice.issue({ id: invoiceId })).rejects.toThrow(/déjà émise/);
    await expect(advisor.invoice.update({ id: invoiceId, notes: "modif" })).rejects.toThrow(
      /plus modifiable/,
    );
  });

  it("OR restitué : l'émission le fait passer INVOICED", async () => {
    const order = await readyOrder("DELIVERED");
    const { customerInvoice } = await advisor.invoice.createFromRepairOrder({
      repairOrderId: order.id,
    });
    const issued = await advisor.invoice.issue({ id: customerInvoice!.id });
    expect(issued.number).toBe("FAC-2026-000002");
    const updated = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("INVOICED");
    expect(updated.invoicedAt).toEqual(NOW);
  });

  it("RG-M08-18 : espèces refusées caisse fermée ; ouverture unique par site", async () => {
    await expect(
      cashier.payment.create({
        customerId: kouassi.id,
        method: "CASH",
        amount: 10_000,
        currentInvoiceId: invoiceId,
      }),
    ).rejects.toThrow("Ouvrez la caisse pour encaisser en espèces.");
    await cashier.cash.open({ openingFloat: 50_000 });
    await expect(owner.cash.open({ openingFloat: 0 })).rejects.toThrow(
      "Une caisse est déjà ouverte sur ce site.",
    );
  });

  it("US-M08-06/08 : paiement partiel espèces puis Wave avec trop-perçu ; référence Wave unique", async () => {
    const partial = await cashier.payment.create({
      customerId: kouassi.id,
      method: "CASH",
      amount: 30_000,
      currentInvoiceId: invoiceId,
    });
    expect(partial.payment.number).toBe("REC-2026-000001");
    expect(partial.receiptUrl).toBe(`/api/caisse/recus/${partial.payment.id}/pdf`);
    let inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv).toMatchObject({ status: "PARTIALLY_PAID", amountPaid: 30_000, balance: 26_464 });

    await expect(
      cashier.payment.create({ customerId: kouassi.id, method: "WAVE", amount: 1_000 }),
    ).rejects.toThrow("Indiquez l'identifiant de la transaction Wave.");
    const wave = await cashier.payment.create({
      customerId: kouassi.id,
      method: "WAVE",
      amount: 31_464,
      reference: "t_8f2a",
      currentInvoiceId: invoiceId,
    });
    // L'autre facture d'OR (56 464) reçoit le reste : 31 464 − 26 464 = 5 000.
    expect(wave.allocations[0]).toEqual({ invoiceId, amount: 26_464 });
    inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv).toMatchObject({ status: "PAID", balance: 0 });
    await expect(
      cashier.payment.create({
        customerId: kouassi.id,
        method: "WAVE",
        amount: 1_000,
        reference: "T_8F2A",
      }),
    ).rejects.toThrow("Cette référence Wave a déjà été enregistrée sur REC-2026-000002.");
    const received = await adminDb.domainEvent.count({
      where: { organizationId: orgA.id, type: "payment.received" },
    });
    expect(received).toBe(2);
  });

  it("US-M08-07 : répartition SOTRA plus anciennes d'abord (240 000 + 410 000 + 150 000)", async () => {
    const ids: string[] = [];
    for (const amount of [240_000, 410_000, 590_000]) {
      const draft = await advisor.invoice.createDirect({
        customerId: sotra.id,
        lines: [
          {
            type: "LABOR",
            description: `Prestation ${amount}`,
            quantity: 1,
            unitPrice: amount,
            vatRate: 0,
          },
        ],
      });
      ids.push((await advisor.invoice.issue({ id: draft.id })).id);
    }
    // Échéances distinctes (création le même jour) : on vieillit les deux premières.
    await adminDb.invoice.update({
      where: { id: ids[0] },
      data: { dueDate: new Date("2026-11-01") },
    });
    await adminDb.invoice.update({
      where: { id: ids[1] },
      data: { dueDate: new Date("2026-11-05") },
    });
    await adminDb.invoice.update({
      where: { id: ids[2] },
      data: { dueDate: new Date("2026-11-18") },
    });
    const suggestion = await cashier.payment.suggestAllocation({
      customerId: sotra.id,
      amount: 800_000,
    });
    expect(suggestion.allocations).toEqual([
      { invoiceId: ids[0], amount: 240_000 },
      { invoiceId: ids[1], amount: 410_000 },
      { invoiceId: ids[2], amount: 150_000 },
    ]);
    const res = await cashier.payment.create({
      customerId: sotra.id,
      method: "BANK_TRANSFER",
      amount: 800_000,
      reference: "VIR-2026-1019",
    });
    expect(res.unallocated).toBe(0);
    const third = await adminDb.invoice.findUniqueOrThrow({ where: { id: ids[2] } });
    expect(third).toMatchObject({ status: "PARTIALLY_PAID", balance: 440_000 });
  });

  it("RG-M08-20 : chèque en attente puis rejeté", async () => {
    const draft = await advisor.invoice.createDirect({
      customerId: kouassi.id,
      lines: [{ type: "PART", productId: filter.id, description: "Filtre à huile", quantity: 2 }],
    });
    const issued = await advisor.invoice.issue({ id: draft.id });
    expect(issued.total).toBe(11_210);
    // Vente comptoir : sortie de stock à l'émission.
    const level = await adminDb.stockLevel.findFirstOrThrow({ where: { productId: filter.id } });
    expect(level.onHand).toBe(10 - 1 - 1 - 2);
    const cheque = await cashier.payment.create({
      customerId: kouassi.id,
      method: "CHEQUE",
      amount: 11_210,
      reference: "0012345 SGCI",
      currentInvoiceId: issued.id,
    });
    expect(cheque.payment.status).toBe("PENDING");
    let inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(inv.status).toBe("ISSUED");
    expect((await owner.invoice.get({ id: issued.id })).pendingCheques).toBe(11_210);
    await accountant.payment.confirmCheque({ id: cheque.payment.id });
    inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(inv.status).toBe("PAID");
    await accountant.payment.failCheque({ id: cheque.payment.id, reason: "Chèque sans provision" });
    inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: issued.id } });
    expect(inv).toMatchObject({ status: "ISSUED", balance: 11_210 });
    expect(
      await adminDb.domainEvent.count({
        where: { organizationId: orgA.id, type: "payment.failed" },
      }),
    ).toBe(1);
  });

  it("US-M08-04 : avoir partiel puis total ; dépassement refusé ; crédit client si payé", async () => {
    await expect(
      advisor.invoice.createCreditNote({ invoiceId, lines: "FULL", reason: "Erreur de client" }),
    ).rejects.toThrow(/Permission manquante/);
    const detail = await accountant.invoice.get({ id: invoiceId });
    const oilLine = detail.lines.find((l) => l.description === "Huile 5W30 (L)")!;
    const partial = await accountant.invoice.createCreditNote({
      invoiceId,
      lines: [{ invoiceLineId: oilLine.id, quantity: 1 }],
      reason: "Litre d'huile non utilisé",
    });
    expect(partial.creditNote).toMatchObject({
      number: "AV-2026-000001",
      type: "CREDIT_NOTE",
      total: -7_493,
    });
    // Facture déjà payée : l'avoir devient un crédit client.
    const credit = await adminDb.customerCredit.findFirstOrThrow({
      where: { sourceId: partial.creditNote.id },
    });
    expect(credit).toMatchObject({ amount: 7_493, remaining: 7_493 });
    expect(partial.invoice).toMatchObject({ status: "PAID", creditedAmount: 7_493 });
    await expect(
      accountant.invoice.createCreditNote({
        invoiceId,
        lines: [
          { invoiceLineId: detail.lines[0]!.id, quantity: 1 },
          { invoiceLineId: oilLine.id, quantity: 4.5 },
        ],
        reason: "Trop",
      }),
    ).rejects.toThrow("L'avoir ne peut pas dépasser 48 971 FCFA.");
    await expect(
      accountant.invoice.createCreditNote({ invoiceId, lines: "FULL", reason: "Annulation" }),
    ).rejects.toThrow(/avoir partiel existe déjà/);
  });

  it("avoir total d'une facture impayée → VOID ; un brouillon ne se crédite pas", async () => {
    const draft = await advisor.invoice.createDirect({
      customerId: kouassi.id,
      lines: [{ type: "LABOR", description: "Diagnostic", quantity: 1, unitPrice: 20_000 }],
    });
    await expect(
      accountant.invoice.createCreditNote({ invoiceId: draft.id, lines: "FULL", reason: "Erreur" }),
    ).rejects.toThrow(/brouillon/);
    await advisor.invoice.issue({ id: draft.id });
    const res = await accountant.invoice.createCreditNote({
      invoiceId: draft.id,
      lines: "FULL",
      reason: "Erreur sur le nom du client",
    });
    expect(res.invoice).toMatchObject({
      status: "VOID",
      balance: 0,
      voidReason: "Erreur sur le nom du client",
    });
    expect(res.creditNote.total).toBe(-23_600);
    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "invoice.credit_note", entityId: draft.id },
    });
    expect(log?.reason).toBe("Erreur sur le nom du client");
  });

  it("US-M08-03 : acompte 50 000 TTC payé puis déduit une seule fois", async () => {
    const deposit = await advisor.invoice.createDeposit({
      customerId: sotra.id,
      amountTtc: 50_000,
    });
    expect(deposit).toMatchObject({
      type: "DEPOSIT",
      subtotal: 42_373,
      vatTotal: 7_627,
      total: 50_000,
    });
    const issuedDeposit = await advisor.invoice.issue({ id: deposit.id });
    const draft = await advisor.invoice.createDirect({
      customerId: sotra.id,
      lines: [{ type: "LABOR", description: "Boîte de vitesses", quantity: 1, unitPrice: 554_000 }],
    });
    await expect(
      advisor.invoice.issue({ id: draft.id, applyDepositIds: [deposit.id] }),
    ).rejects.toThrow(/pas encore payé/);
    await cashier.payment.create({
      customerId: sotra.id,
      method: "CASH",
      amount: 50_000,
      allocations: [{ invoiceId: issuedDeposit.id, amount: 50_000 }],
    });
    const final = await advisor.invoice.issue({ id: draft.id, applyDepositIds: [deposit.id] });
    expect(final.total).toBe(603_720);
    const other = await advisor.invoice.createDirect({
      customerId: sotra.id,
      lines: [{ type: "LABOR", description: "Autre", quantity: 1, unitPrice: 100_000 }],
    });
    await expect(
      advisor.invoice.issue({ id: other.id, applyDepositIds: [deposit.id] }),
    ).rejects.toThrow(/déjà été déduit/);
  });

  it("RG-M08-22 : remboursement du trop-perçu en espèces", async () => {
    // Trop-perçu : 5 000 restés non affectés ? Ici le trop-perçu Wave a été affecté à la 2e facture
    // d'OR ; on crée un trop-perçu explicite.
    const res = await cashier.payment.create({
      customerId: kouassi.id,
      method: "CASH",
      amount: 200_000,
    });
    expect(res.unallocated).toBeGreaterThan(0);
    await expect(
      owner.refund.create({
        paymentId: res.payment.id,
        amount: res.unallocated + 1,
        method: "CASH",
        reason: "Trop-perçu",
      }),
    ).rejects.toThrow(/ne peut pas dépasser/);
    const refund = await owner.refund.create({
      paymentId: res.payment.id,
      amount: 5_000,
      method: "CASH",
      reason: "Rendu monnaie trop-perçu",
    });
    expect(refund.cashSessionId).not.toBeNull();
  });

  it("US-M08-11/12 : dépense, versement, clôture avec écart commenté", async () => {
    const current = await cashier.cash.current({});
    const session = current.session!;
    await expect(
      cashier.cash.expense({
        sessionId: session.id,
        category: "Carburant",
        amount: 30_000,
        description: "Essai",
      }),
    ).rejects.toThrow(/validée par le gérant/);
    await cashier.cash.expense({
      sessionId: session.id,
      category: "Carburant",
      amount: 12_500,
      description: "Essai routier",
    });
    await cashier.cash.drop({ sessionId: session.id, amount: 40_000, destination: "safe" });
    const summary = (await cashier.cash.current({})).session!;
    // 50 000 + espèces (30 000 + 50 000 + 200 000) − 12 500 − 5 000 − 40 000.
    expect(summary.expectedCash).toBe(272_500);
    await expect(cashier.cash.close({ id: session.id, countedCash: 270_000 })).rejects.toThrow(
      /commentaire est obligatoire/,
    );
    await expect(
      cashier.cash.close({
        id: session.id,
        countedCash: 270_000,
        denominations: { "10000": 1 },
        notes: "x",
      }),
    ).rejects.toThrow(/ne correspond pas/);
    const closed = await cashier.cash.close({
      id: session.id,
      denominations: { "10000": 27 },
      notes: "Erreur de rendu",
    });
    expect(closed).toMatchObject({
      expectedCash: 272_500,
      countedCash: 270_000,
      difference: -2_500,
      lateClose: false,
    });
    await expect(cashier.cash.review({ id: session.id, comment: "Vu" })).rejects.toThrow(
      /Permission manquante/,
    );
    await owner.cash.review({ id: session.id, comment: "Écart accepté" });
    // Écart sous le seuil (5 000) : pas d'alerte au propriétaire.
    expect(
      await adminDb.notification.count({
        where: { organizationId: orgA.id, type: "cash.variance" },
      }),
    ).toBe(0);
  });

  it("RG-M08-31 : export SYSCOHADA équilibré", async () => {
    const res = await accountant.accounting.export({
      from: "2026-10-19",
      to: "2026-10-19",
      journal: "ALL",
    });
    expect(res.debit).toBe(res.credit);
    expect(res.csv.startsWith("\uFEFFJournal;Date;N° pièce")).toBe(true);
    expect(res.csv).toContain("VT;19/10/2026;FAC-2026-000001;411;");
    expect(res.csv).toContain("EN;19/10/2026;REC-2026-000001;571;");
    expect(res.csv).toContain("CA;19/10/2026;");
    await expect(
      cashier.accounting.export({ from: "2026-10-19", to: "2026-10-19", journal: "ALL" }),
    ).rejects.toThrow(/Permission manquante/);
  });

  it("RG-M08-04 : émission bloquée sans RCCM/NCC", async () => {
    const org = await adminDb.organization.create({
      data: { name: "Garage sans NCC", onboardingCompletedAt: NOW },
    });
    orgIds.push(org.id);
    await adminDb.site.create({ data: { organizationId: org.id, name: "Site", code: "SIT" } });
    const c = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Client" },
    });
    const ownerC = (await member(org.id, "OWNER")).caller;
    const draft = await ownerC.invoice.createDirect({
      customerId: c.id,
      lines: [{ type: "LABOR", description: "MO", quantity: 1, unitPrice: 1_000 }],
    });
    await expect(ownerC.invoice.issue({ id: draft.id })).rejects.toThrow(/NCC, RCCM/);
  });

  it("RG-M08-01 : 50 émissions concurrentes → FAC-…-000001 à 000050, sans trou ni doublon", async () => {
    const org = await adminDb.organization.create({
      data: { name: "Garage Concurrence", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgIds.push(org.id);
    await adminDb.site.create({ data: { organizationId: org.id, name: "Site", code: "CON" } });
    const c = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Client" },
    });
    const ownerC = (await member(org.id, "OWNER")).caller;
    const drafts = [];
    for (let i = 0; i < 50; i++) {
      drafts.push(
        await ownerC.invoice.createDirect({
          customerId: c.id,
          lines: [{ type: "LABOR", description: `MO ${i}`, quantity: 1, unitPrice: 1_000 + i }],
        }),
      );
    }
    const issued = await Promise.all(drafts.map((d) => ownerC.invoice.issue({ id: d.id })));
    const numbers = issued.map((i) => i.number!).sort();
    expect(new Set(numbers).size).toBe(50);
    expect(numbers[0]).toBe("FAC-2026-000001");
    expect(numbers[49]).toBe("FAC-2026-000050");
  }, 60_000);

  it("isolation multi-locataire : l'organisation B ne voit ni n'encaisse les factures de A", async () => {
    await expect(callerB.invoice.get({ id: invoiceId })).rejects.toThrow("Facture introuvable.");
    await expect(callerB.invoice.issue({ id: invoiceId })).rejects.toThrow("Facture introuvable.");
    await expect(
      callerB.invoice.createCreditNote({ invoiceId, lines: "FULL", reason: "Intrusion" }),
    ).rejects.toThrow("Facture introuvable.");
    await expect(
      callerB.payment.create({
        customerId: kouassi.id,
        method: "WAVE",
        amount: 1_000,
        reference: "X1",
      }),
    ).rejects.toThrow("Client introuvable.");
    expect((await callerB.invoice.list({})).items).toHaveLength(0);
    expect((await callerB.payment.list({})).items).toHaveLength(0);
    expect((await callerB.cash.sessions({})).items).toHaveLength(0);
    const exportB = await callerB.accounting.export({
      from: "2026-10-19",
      to: "2026-10-19",
      journal: "ALL",
    });
    expect(exportB.count).toBe(0);
  });
});
