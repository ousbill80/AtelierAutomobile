import { fixedClock } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { FakeFneProvider } from "@atelieros/integrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processFneCertifyJob, retryDueFneInvoices } from "./fne";

// Horloge figée : 19/10/2026 10:00 à Abidjan (UTC+0).
const NOW = new Date("2026-10-19T10:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe("fne.certify / fne.retry (RG-M08-15)", () => {
  let org: { id: string };
  let invoiceId: string;

  beforeAll(async () => {
    org = await adminDb.organization.create({
      data: { name: "Garage FNE Worker", ncc: "1912345A", onboardingCompletedAt: NOW },
    });
    const site = await adminDb.site.create({
      data: { organizationId: org.id, name: "Yopougon", code: "YOP" },
    });
    const customer = await adminDb.customer.create({
      data: { organizationId: org.id, displayName: "Kouassi Jean-Marc" },
    });
    await adminDb.fneConfig.create({
      data: { organizationId: org.id, mode: "api", provider: "fake", isActive: true },
    });
    const invoice = await adminDb.invoice.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        customerId: customer.id,
        number: "FAC-2026-000001",
        status: "ISSUED",
        issuedAt: NOW,
        subtotal: 15_000,
        vatTotal: 2_700,
        total: 17_700,
        balance: 17_700,
        fneStatus: "PENDING",
        fneNextRetryAt: NOW,
      },
    });
    invoiceId = invoice.id;
    await adminDb.invoiceLine.create({
      data: {
        organizationId: org.id,
        invoiceId,
        type: "LABOR",
        description: "MO Vidange",
        quantity: 1,
        unitPrice: 15_000,
        vatRate: 18,
        lineSubtotal: 15_000,
        lineVat: 2_700,
        lineTotal: 17_700,
      },
    });
  });

  afterAll(async () => {
    const where = { organizationId: org.id };
    await adminDb.auditLog.deleteMany({ where });
    await adminDb.domainEvent.deleteMany({ where });
    await adminDb.invoiceLine.deleteMany({ where });
    await adminDb.invoice.deleteMany({ where });
    await adminDb.fneConfig.deleteMany({ where });
    await adminDb.customer.deleteMany({ where });
    await adminDb.site.deleteMany({ where });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("certify en échec transitoire, reprise à +10 min par le balayage, puis certifiée", async () => {
    const provider = new FakeFneProvider({ failTimes: 1 });
    const resolve = async () => provider;
    expect(
      await processFneCertifyJob({ organizationId: org.id, invoiceId }, fixedClock(NOW), resolve),
    ).toMatchObject({ outcome: "failed", kind: "transient" });
    // Le balayage global n'est pas lancé ici : il toucherait les factures des autres suites.
    expect(await retryDueFneInvoices(org.id, at(9), resolve)).toBe(0);
    expect(await retryDueFneInvoices(org.id, at(10), resolve)).toBe(1);
    const invoice = await adminDb.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice).toMatchObject({
      fneStatus: "CERTIFIED",
      fneNumber: "SIM-FAC-2026-000001",
      fneAttempts: 2,
    });
    // Job rejoué (BullMQ) : idempotent, aucun nouvel appel.
    expect(
      await processFneCertifyJob(
        { organizationId: org.id, invoiceId },
        fixedClock(at(11)),
        resolve,
      ),
    ).toMatchObject({ outcome: "skipped" });
    expect(provider.calls).toBe(2);
  });
});
