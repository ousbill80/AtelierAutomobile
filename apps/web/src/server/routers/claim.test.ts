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
type Role = "OWNER" | "ADVISOR" | "CASHIER" | "ACCOUNTANT";

// Horloge figée (jamais l'heure réelle) : 20/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-20T10:00:00.000Z");

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}`, "x-forwarded-for": "41.202.10.78" },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

const users: string[] = [];

async function member(organizationId: string, role: Role): Promise<Caller> {
  const user = await adminDb.user.create({
    data: {
      name: `${role} ${randomBytes(2).toString("hex")}`,
      email: `${randomBytes(5).toString("hex")}@example.com`,
    },
  });
  users.push(user.id);
  await adminDb.membership.create({
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
  return callerFactory(await contextFor(token));
}

const IDENTITY = {
  legalName: "Garage Marcory SARL",
  rccm: "CI-ABJ-2020-B-54321",
  ncc: "2012345B",
  address: "Marcory, Abidjan",
  phone: "+2252721000000",
  taxRegime: "RNI" as const,
};

const checkOut = {
  mileage: 61_200,
  fuelLevel: 4,
  itemsConfirmed: true,
  oldPartsReturned: true,
  collectedBy: { name: "Traoré Aminata" },
};

describe("M16 — assurances et sinistres", () => {
  const orgIds: string[] = [];
  let orgA: { id: string };
  let siteA: { id: string };
  let owner: Caller;
  let advisor: Caller;
  let cashier: Caller;
  let accountant: Caller;
  let callerB: Caller;
  let traore: { id: string };
  let vehicle: { id: string };
  let orderId: string;
  let claimId: string;
  let insurerId: string;
  let insurerCustomerId: string;

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    setRepairOrdersClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({
      data: { name: "Garage Sinistres A", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    const orgB = await adminDb.organization.create({
      data: { name: "Garage Sinistres B", onboardingCompletedAt: NOW, ...IDENTITY },
    });
    orgIds.push(orgA.id, orgB.id);
    siteA = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Marcory", code: "MAR" },
    });
    await adminDb.site.create({ data: { organizationId: orgB.id, name: "Cocody", code: "COC" } });
    owner = await member(orgA.id, "OWNER");
    advisor = await member(orgA.id, "ADVISOR");
    cashier = await member(orgA.id, "CASHIER");
    accountant = await member(orgA.id, "ACCOUNTANT");
    callerB = await member(orgB.id, "OWNER");
    traore = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "Mme Traoré Aminata",
        phone: "+2250707000031",
        paymentTermsDays: 0,
      },
    });
    vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: traore.id,
        plate: "4471 HJ 01",
        plateCompact: "4471HJ01",
        make: "Hyundai",
        model: "Tucson",
      },
    });
    const order = await adminDb.repairOrder.create({
      data: {
        organizationId: orgA.id,
        siteId: siteA.id,
        number: "OR-MAR-2026-00031",
        customerId: traore.id,
        vehicleId: vehicle.id,
        status: "CHECKED_IN",
        mileageIn: 61_000,
      },
    });
    orderId = order.id;
    // RG-M16-03 : pare-choc, phare, peinture, MO tôlerie 6 h, MO peinture 5 h → 554 000 HT.
    const lines = [
      { type: "PART", description: "Pare-choc AV", quantity: 1, unitPrice: 185_000 },
      { type: "PART", description: "Phare AV gauche", quantity: 1, unitPrice: 142_000 },
      {
        type: "CONSUMABLE",
        description: "Peinture et ingrédients",
        quantity: 1,
        unitPrice: 95_000,
      },
      { type: "LABOR", description: "MO tôlerie", quantity: 6, unitPrice: 12_000 },
      { type: "LABOR", description: "MO peinture", quantity: 5, unitPrice: 12_000 },
    ] as const;
    for (const [i, l] of lines.entries()) {
      await adminDb.repairOrderLine.create({
        data: {
          organizationId: orgA.id,
          repairOrderId: order.id,
          ...l,
          vatRate: 18,
          payer: "INSURANCE",
          status: "DONE",
          sortOrder: i,
        },
      });
    }
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await adminDb.claimFollowUp.deleteMany({ where });
    await adminDb.claimActivity.deleteMany({ where });
    await adminDb.attachment.deleteMany({ where });
    await adminDb.paymentAttribution.deleteMany({ where });
    await adminDb.paymentAllocation.deleteMany({ where });
    await adminDb.customerCredit.deleteMany({ where });
    await adminDb.payment.deleteMany({ where });
    await adminDb.reminder.deleteMany({ where });
    await adminDb.stockMovement.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where: { ...where, creditedInvoiceId: { not: null } } });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.collectionCase.deleteMany({ where });
    await adminDb.repairOrderStatusHistory.deleteMany({ where });
    await adminDb.repairOrderLine.deleteMany({ where });
    await adminDb.repairOrder.updateMany({ where, data: { insuranceClaimId: null } });
    await adminDb.quoteLine.deleteMany({ where });
    await adminDb.quote.updateMany({ where, data: { insuranceClaimId: null } });
    await adminDb.insuranceClaim.deleteMany({ where });
    await adminDb.quote.deleteMany({ where });
    await adminDb.repairOrder.deleteMany({ where });
    await adminDb.insuranceCompany.deleteMany({ where });
    await adminDb.documentSequence.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.vehicle.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.notification.deleteMany({ where });
    await adminDb.membership.deleteMany({ where });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("crée la compagnie avec son Customer de facturation (RG-M16-01)", async () => {
    await expect(advisor.insurer.create({ name: "NSIA Assurances" })).rejects.toThrow(
      /insurer:edit/,
    );
    const insurer = await accountant.insurer.create({
      name: "NSIA Assurances",
      claimsEmail: "sinistres@nsia.example",
      paymentTermsDays: 60,
    });
    insurerId = insurer.id;
    insurerCustomerId = insurer.customerId;
    const customer = await adminDb.customer.findUniqueOrThrow({
      where: { id: insurer.customerId },
    });
    expect(customer).toMatchObject({ type: "COMPANY", paymentTermsDays: 60, doNotRemind: true });
    expect(await callerB.insurer.list()).toEqual([]);
  });

  it("ouvre le dossier depuis l'OR, numéroté par site (A4), invisible d'une autre organisation", async () => {
    const { claim } = await advisor.claim.create({
      repairOrderId: orderId,
      insuranceCompanyId: insurerId,
      accidentDate: "2026-10-12",
      deductible: 100_000,
    });
    claimId = claim.id;
    expect(claim.number).toBe("SIN-MAR-2026-00001");
    expect(claim.status).toBe("OPENED");
    const order = await adminDb.repairOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.insuranceClaimId).toBe(claimId);
    await expect(callerB.claim.get({ id: claimId })).rejects.toThrow(/introuvable/i);
    expect((await callerB.claim.list({})).items).toEqual([]);
    expect((await advisor.claim.list({ q: "4471" })).items.map((c) => c.id)).toEqual([claimId]);
    // L'OR sinistre se facture depuis le dossier, pas depuis l'OR.
    await expect(advisor.invoice.createFromRepairOrder({ repairOrderId: orderId })).rejects.toThrow(
      /dossier sinistre/,
    );
  });

  it("expertise, devis assurance, accord partiel : écart à trancher, absorption réservée", async () => {
    await advisor.claim.scheduleExpert({
      id: claimId,
      expertName: "M. Diabaté",
      expertVisitAt: new Date("2026-10-14T09:00:00.000Z"),
    });
    // Devis assurance prérempli avec les travaux de l'OR (lignes à la charge de l'assureur).
    const quote = await advisor.claim.createQuote({ id: claimId });
    const q = await adminDb.quote.findUniqueOrThrow({
      where: { id: quote.quoteId },
      include: { lines: true },
    });
    expect(q.lines).toHaveLength(5);
    expect(q.lines.every((l) => l.payer === "INSURANCE")).toBe(true);
    expect(q.total).toBe(653_720);
    const sent = await advisor.claim.sendEstimate({ id: claimId, channel: "email" });
    expect(sent.claim.status).toBe("ESTIMATE_SENT");

    // Accord 600 000 sur un devis de 653 720 : il faut choisir le traitement de l'écart.
    await expect(
      advisor.claim.recordApproval({ id: claimId, approvedAmount: 600_000, deductible: 100_000 }),
    ).rejects.toThrow(/53 720 FCFA/);
    await expect(
      advisor.claim.recordApproval({
        id: claimId,
        approvedAmount: 600_000,
        deductible: 100_000,
        gapHandling: "GARAGE",
        reason: "Geste commercial",
      }),
    ).rejects.toThrow(/claim:absorb_gap/);
    await expect(
      cashier.claim.recordApproval({ id: claimId, approvedAmount: 653_720, deductible: 100_000 }),
    ).rejects.toThrow(/claim:approve_record/);
    const approved = await advisor.claim.recordApproval({
      id: claimId,
      approvedAmount: 653_720,
      deductible: 100_000,
      approvalRef: "ACC-NSIA-889",
    });
    expect(approved.claim.status).toBe("APPROVED");
    expect(approved.split).toMatchObject({ insurerShare: 553_720, customerShare: 100_000 });
  });

  it("facture le sinistre en deux (553 720 assureur / 100 000 client) et bloque la restitution", async () => {
    await expect(accountant.claim.invoice({ id: claimId })).rejects.toThrow(/n° de sinistre/);
    await advisor.claim.update({ id: claimId, claimNumber: "NSIA-2026-4471" });
    await expect(accountant.claim.invoice({ id: claimId })).rejects.toThrow(/PV d'expertise/);
    await adminDb.attachment.create({
      data: {
        organizationId: orgA.id,
        entity: "claim",
        entityId: claimId,
        kind: "approval_letter",
        url: `${orgA.id}/claims/${claimId}/accord.pdf`,
        mimeType: "application/pdf",
        size: 1_024,
      },
    });
    const res = await accountant.claim.invoice({ id: claimId });
    expect(res.insurerInvoice).toMatchObject({ billTo: "INSURANCE", total: 553_720 });
    expect(res.customerInvoice).toMatchObject({ billTo: "CUSTOMER", total: 100_000 });
    expect(res.insurerInvoice.customerId).toBe(insurerCustomerId);

    const insurerIssued = await accountant.invoice.issue({ id: res.insurerInvoice.id });
    let claim = await adminDb.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("APPROVED"); // facture client encore en brouillon
    await accountant.invoice.issue({ id: res.customerInvoice!.id });
    claim = await adminDb.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("INVOICED");
    // Échéance assurance : délai de la compagnie (60 j).
    const issued = await adminDb.invoice.findUniqueOrThrow({ where: { id: insurerIssued.id } });
    expect(issued.dueDate).toEqual(new Date("2026-12-19T00:00:00.000Z"));

    // RG-M16-10 : seule la franchise bloque la restitution, jamais la facture assurance.
    await adminDb.repairOrder.update({ where: { id: orderId }, data: { status: "READY" } });
    await expect(advisor.repairOrder.deliver({ id: orderId, checkOut })).rejects.toThrow(
      "Solde à régler : 100 000 FCFA",
    );
  });

  it("répartit un virement de l'assureur sur 3 dossiers et solde chacun (US-M16-07)", async () => {
    const others: string[] = [];
    for (const [n, amount] of [
      [2, 410_000],
      [3, 236_280],
    ] as const) {
      const claim = await adminDb.insuranceClaim.create({
        data: {
          organizationId: orgA.id,
          siteId: siteA.id,
          number: `SIN-MAR-2026-0000${n}`,
          insuranceCompanyId: insurerId,
          customerId: traore.id,
          vehicleId: vehicle.id,
          status: "INVOICED",
        },
      });
      others.push(claim.id);
      await adminDb.invoice.create({
        data: {
          organizationId: orgA.id,
          siteId: siteA.id,
          customerId: insurerCustomerId,
          insuranceClaimId: claim.id,
          billTo: "INSURANCE",
          type: "INVOICE",
          status: "ISSUED",
          number: `FAC-2026-90${n}`,
          issuedAt: new Date(`2026-0${n + 5}-01T09:00:00.000Z`),
          dueDate: new Date(`2026-0${n + 6}-01T00:00:00.000Z`),
          total: amount,
          balance: amount,
        },
      });
    }
    const stats = await accountant.insurer.stats({});
    expect(stats.find((s) => s.insurerId === insurerId)).toMatchObject({
      openClaims: 3,
      outstanding: 553_720 + 410_000 + 236_280,
    });

    const payment = await cashier.payment.create({
      customerId: insurerCustomerId,
      method: "BANK_TRANSFER",
      amount: 1_200_000,
      reference: "VIR-NSIA-20261020",
    });
    expect(payment.allocations).toHaveLength(3);
    for (const id of others) {
      const c = await adminDb.insuranceClaim.findUniqueOrThrow({ where: { id } });
      expect(c.status).toBe("PAID");
    }
    let main = await adminDb.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(main.status).toBe("PARTIALLY_PAID"); // franchise client encore due

    const customerInvoice = await adminDb.invoice.findFirstOrThrow({
      where: { insuranceClaimId: claimId, billTo: "CUSTOMER" },
    });
    await cashier.payment.create({
      customerId: traore.id,
      method: "WAVE",
      amount: 100_000,
      reference: "T_FRANCHISE_31",
      currentInvoiceId: customerInvoice.id,
    });
    main = await adminDb.insuranceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(main.status).toBe("PAID");
    expect(main.closedAt).toEqual(new Date("2026-10-20T00:00:00.000Z")); // date métier du règlement
    const delivered = await advisor.repairOrder.deliver({ id: orderId, checkOut });
    expect(delivered.deliveredAt).toEqual(NOW); // OR déjà facturé → INVOICED (M04)
    await expect(callerB.claim.followUps({})).resolves.toEqual([]);
    expect(owner).toBeTruthy();
  });
});
