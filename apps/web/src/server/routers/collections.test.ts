import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, fixedClock } from "@atelieros/core";
import { adminDb, db, DEFAULT_COLLECTION_SETTINGS, syncCustomerReceivables } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { setReceivablesClock } from "../receivables/helpers";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function memberContextFor(
  organizationId: string,
  name: string,
  role: "OWNER" | "CASHIER" = "OWNER",
) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  await adminDb.membership.create({ data: { organizationId, userId: user.id, role, siteIds: [] } });
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
  return { userId: user.id, token };
}

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const NOW = new Date("2026-10-07T09:00:00.000Z");

describe("collections / payment routers (M09)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  const users: string[] = [];
  let callerA: ReturnType<typeof callerFactory>;
  let callerB: ReturnType<typeof callerFactory>;
  let cashierA: ReturnType<typeof callerFactory>;
  let kone: { id: string };
  let sotra: { id: string };
  let koneInvoice: { id: string };
  let sotraInvoices: { id: string }[];

  async function sync(customerId: string) {
    return db.forTenant({ organizationId: orgA.id }).transaction((tx) =>
      syncCustomerReceivables(tx, {
        organizationId: orgA.id,
        customerId,
        today: d(NOW.toISOString().slice(0, 10)),
        now: NOW,
        settings: DEFAULT_COLLECTION_SETTINGS,
      }),
    );
  }

  beforeAll(async () => {
    setReceivablesClock(fixedClock(NOW));
    orgA = await adminDb.organization.create({ data: { name: "Garage Créances Test A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Créances Test B" } });
    const ownerA = await memberContextFor(orgA.id, "Owner Créances A");
    const ownerB = await memberContextFor(orgB.id, "Owner Créances B");
    const cashier = await memberContextFor(orgA.id, "Caissier A", "CASHIER");
    users.push(ownerA.userId, ownerB.userId, cashier.userId);
    callerA = callerFactory(await contextFor(ownerA.token));
    callerB = callerFactory(await contextFor(ownerB.token));
    cashierA = callerFactory(await contextFor(cashier.token));
    const site = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Yopougon", code: "YOP" },
    });
    kone = await adminDb.customer.create({
      data: { organizationId: orgA.id, displayName: "Koné Ibrahim", phone: "+2250152770943" },
    });
    sotra = await adminDb.customer.create({
      data: {
        organizationId: orgA.id,
        displayName: "SOTRA Logistique SARL",
        type: "COMPANY",
        creditLimit: 1_000_000,
      },
    });
    const invoice = (customerId: string, number: string, total: number, due: string) =>
      adminDb.invoice.create({
        data: {
          organizationId: orgA.id,
          siteId: site.id,
          customerId,
          number,
          status: "ISSUED",
          issuedAt: d(due),
          dueDate: d(due),
          total,
          balance: total,
          origin: "IMPORTED",
        },
      });
    koneInvoice = await invoice(kone.id, "FAC-2026-000412", 185_000, "2026-10-06");
    sotraInvoices = [
      await invoice(sotra.id, "FAC-2026-000350", 640_000, "2026-08-16"),
      await invoice(sotra.id, "FAC-2026-000388", 400_000, "2026-08-30"),
      await invoice(sotra.id, "FAC-2026-000447", 200_000, "2026-10-02"),
    ];
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.paymentAttribution.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.paymentAllocation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.collectionCase.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.documentSequence.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.domainEvent.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.session.deleteMany({ where: { userId: { in: users } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: users } } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("US-M09-02 : la facture passe OVERDUE et un dossier OPEN s'ouvre, ancre figée", async () => {
    const result = await sync(kone.id);
    expect(result.caseId).toBeTruthy();
    const kase = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: result.caseId! } });
    expect(kase).toMatchObject({
      status: "OPEN",
      totalDue: 185_000,
      overdueDue: 185_000,
      stage: 0,
    });
    expect(kase.anchorDate).toEqual(d("2026-10-06"));
    const inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: koneInvoice.id } });
    expect(inv).toMatchObject({ status: "OVERDUE", collectionCaseId: kase.id });
    // idempotent : pas de second dossier
    expect((await sync(kone.id)).caseId).toBe(kase.id);
    expect(await adminDb.collectionCase.count({ where: { customerId: kone.id } })).toBe(1);
  });

  it("balance âgée : somme des tranches = total ; isolation multi-locataire", async () => {
    await sync(sotra.id);
    const a = await callerA.collections.agingSummary({});
    expect(a.total).toBe(185_000 + 1_240_000);
    expect(a.notDue + a.buckets.b0_30 + a.buckets.b31_60 + a.buckets.b61_90 + a.buckets.b90p).toBe(
      a.total,
    );
    expect(a.buckets.b31_60).toBe(1_040_000);
    expect(a.customersCount).toBe(2);

    const b = await callerB.collections.agingSummary({});
    expect(b.total).toBe(0);
    const listB = await callerB.collections.listCases({ tab: "ALL" });
    expect(listB.items).toHaveLength(0);
    const listA = await callerA.collections.listCases({ tab: "ALL" });
    expect(listA.items.map((c) => c.customer.displayName).sort()).toEqual([
      "Koné Ibrahim",
      "SOTRA Logistique SARL",
    ]);
    await expect(callerB.collections.getCase({ id: listA.items[0]!.id })).rejects.toThrow();
    await expect(
      callerB.payment.record({
        customerId: kone.id,
        amount: 1_000,
        method: "CASH",
        receivedAt: "2026-10-07",
      }),
    ).rejects.toThrow("Client introuvable.");
  });

  it("contrôle du crédit : SOTRA bloqué (plafond), Koné averti", async () => {
    const s = await callerA.collections.creditCheck({ customerId: sotra.id });
    expect(s.level).toBe("BLOCK");
    expect(s.reasons).toContain("OVER_LIMIT");
    const k = await callerA.collections.creditCheck({ customerId: kone.id });
    expect(k.level).toBe("WARN");
  });

  it("US-M09-03 : promesse → PROMISED ; date passée refusée", async () => {
    const caseId = (
      await adminDb.collectionCase.findFirstOrThrow({ where: { customerId: kone.id } })
    ).id;
    await expect(
      callerA.collections.addPromise({
        caseId,
        installments: [{ amount: 100_000, date: "2026-10-01" }],
        channel: "phone",
      }),
    ).rejects.toThrow("La date promise doit être aujourd'hui ou plus tard.");
    await expect(
      callerA.collections.addPromise({
        caseId,
        installments: [{ amount: 900_000, date: "2026-10-10" }],
        channel: "phone",
      }),
    ).rejects.toThrow("Le montant promis dépasse le solde dû (185 000 FCFA).");
    const created = await callerA.collections.addPromise({
      caseId,
      installments: [{ amount: 185_000, date: "2026-10-10" }],
      channel: "phone",
    });
    expect(created).toHaveLength(1);
    const kase = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(kase.status).toBe("PROMISED");
    expect(kase.pausedUntil).toEqual(d("2026-10-11"));
    await expect(
      callerB.collections.addPromise({
        caseId,
        installments: [{ amount: 1_000, date: "2026-10-10" }],
        channel: "phone",
      }),
    ).rejects.toThrow();
  });

  it("paiement manuel Wave 185 000 : facture payée, promesse tenue, dossier fermé, numéro REC", async () => {
    const res = await cashierA.payment.record({
      customerId: kone.id,
      amount: 185_000,
      method: "WAVE",
      receivedAt: "2026-10-07",
      reference: "WAVE-TX-1",
    });
    expect(res.payment.number).toBe("REC-2026-000001");
    expect(res.unallocated).toBe(0);
    const inv = await adminDb.invoice.findUniqueOrThrow({ where: { id: koneInvoice.id } });
    expect(inv).toMatchObject({ status: "PAID", balance: 0, amountPaid: 185_000 });
    const kase = await adminDb.collectionCase.findFirstOrThrow({ where: { customerId: kone.id } });
    expect(kase.status).toBe("CLOSED_PAID");
    const promise = await adminDb.paymentPromise.findFirstOrThrow({
      where: { collectionCaseId: kase.id },
    });
    expect(promise.status).toBe("KEPT");
    expect(
      await adminDb.paymentAttribution.count({
        where: { organizationId: orgA.id, source: "spontaneous" },
      }),
    ).toBe(1);
    const event = await adminDb.domainEvent.findFirst({
      where: { organizationId: orgA.id, type: "payment.received" },
    });
    expect(event).toBeTruthy();
  });

  it("litige : facture DISPUTED, dossier DISPUTED ; perte interdite au caissier", async () => {
    const caseId = (
      await adminDb.collectionCase.findFirstOrThrow({ where: { customerId: sotra.id } })
    ).id;
    await callerA.collections.openDispute({
      caseId,
      invoiceIds: [sotraInvoices[2]!.id],
      reason: "Conteste 2 h de MO",
    });
    expect(
      (await adminDb.invoice.findUniqueOrThrow({ where: { id: sotraInvoices[2]!.id } })).status,
    ).toBe("DISPUTED");
    expect((await adminDb.collectionCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe(
      "DISPUTED",
    );
    await expect(
      callerA.collections.writeOff({ invoiceIds: [sotraInvoices[2]!.id], reason: "Injoignable" }),
    ).rejects.toThrow("Facture en litige");
    await expect(
      cashierA.collections.writeOff({ invoiceIds: [sotraInvoices[0]!.id], reason: "Injoignable" }),
    ).rejects.toThrow(/Permission manquante/);
    await callerA.collections.resolveDispute({
      caseId,
      resolution: "PAY",
      note: "Client accepte de payer",
    });
    const kase = await adminDb.collectionCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(kase.status).toBe("PAUSED");
    expect(kase.pausedUntil).toEqual(d("2026-10-14"));
  });

  it("passage en perte < 90 j : confirmation par le montant, audit", async () => {
    await expect(
      callerA.collections.writeOff({ invoiceIds: [sotraInvoices[0]!.id], reason: "Injoignable" }),
    ).rejects.toThrow(/saisissez le montant total/);
    await callerA.collections.writeOff({
      invoiceIds: [sotraInvoices[0]!.id],
      reason: "Injoignable",
      confirmAmount: 640_000,
    });
    expect(
      (await adminDb.invoice.findUniqueOrThrow({ where: { id: sotraInvoices[0]!.id } })).status,
    ).toBe("WRITTEN_OFF");
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: orgA.id, action: "receivable.writeoff" },
      }),
    ).toBe(1);
    const aging = await callerA.collections.agingSummary({});
    expect(aging.total).toBe(600_000);
  });

  it("relevé de compte : solde de clôture = Σ factures − paiements", async () => {
    const s = await callerA.collections.statement({
      customerId: kone.id,
      from: "2026-01-01",
      to: "2026-10-07",
    });
    expect(s.totalDebit).toBe(185_000);
    expect(s.totalCredit).toBe(185_000);
    expect(s.closingBalance).toBe(0);
    await expect(
      callerB.collections.statement({ customerId: kone.id, from: "2026-01-01", to: "2026-10-07" }),
    ).rejects.toThrow();
  });
});
