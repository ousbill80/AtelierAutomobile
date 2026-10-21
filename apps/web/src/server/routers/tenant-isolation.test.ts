import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string) {
  const req = new Request("http://localhost/api/trpc", {
    headers: { cookie: `atelieros_session=${token}` },
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function ownerContextFor(organizationId: string, name: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(6).toString("hex")}@isolation-test.ci` },
  });
  await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: "OWNER", siteIds: [] },
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
  return { userId: user.id, token };
}

describe("Global Multi-Tenant Isolation Audit (CLAUDE.md & Étape 7.1)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };

  let customerB: { id: string };
  let vehicleB: { id: string };
  let quoteB: { id: string };
  let invoiceB: { id: string };
  let appointmentB: { id: string };
  let repairOrderB: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({
      data: { name: "Garage Isolation Audit A", slug: `audit-a-${randomBytes(4).toString("hex")}` },
    });
    orgB = await adminDb.organization.create({
      data: { name: "Garage Isolation Audit B", slug: `audit-b-${randomBytes(4).toString("hex")}` },
    });
    siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Site Audit B", code: "SITB" },
    });
    ownerA = await ownerContextFor(orgA.id, "Owner Audit A");
    ownerB = await ownerContextFor(orgB.id, "Owner Audit B");

    customerB = await adminDb.customer.create({
      data: {
        organizationId: orgB.id,
        displayName: "Client Isolation B",
        type: "INDIVIDUAL",
      },
    });

    // Données créées sur l'organisation B
    vehicleB = await adminDb.vehicle.create({
      data: {
        organizationId: orgB.id,
        customerId: customerB.id,
        plate: "1234AB01",
        plateCompact: "1234AB01",
        make: "Toyota",
        model: "Hilux",
      },
    });

    quoteB = await adminDb.quote.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        number: "DEV-TEST-B",
        customerId: customerB.id,
        status: "DRAFT",
        validUntil: new Date("2026-12-31"),
        subtotal: 10000,
        vatTotal: 1800,
        total: 11800,
      },
    });

    invoiceB = await adminDb.invoice.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        number: "FAC-TEST-B",
        customerId: customerB.id,
        status: "DRAFT",
        subtotal: 20000,
        vatTotal: 3600,
        total: 23600,
        balance: 23600,
      },
    });

    appointmentB = await adminDb.appointment.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        customerId: customerB.id,
        vehicleId: vehicleB.id,
        startsAt: new Date("2026-10-21T09:00:00Z"),
        endsAt: new Date("2026-10-21T10:00:00Z"),
        type: "SERVICE",
      },
    });

    repairOrderB = await adminDb.repairOrder.create({
      data: {
        organizationId: orgB.id,
        siteId: siteB.id,
        customerId: customerB.id,
        vehicleId: vehicleB.id,
        number: "OR-TEST-B",
        complaint: "Isolation audit",
      },
    });
  });

  afterAll(async () => {
    await adminDb.invoice.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.quote.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.repairOrder.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.appointment.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("isolation Véhicule : le garage A ne peut pas lire le véhicule du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.vehicle.get({ id: vehicleB.id })).rejects.toThrow();
  });

  it("isolation Devis : le garage A ne peut pas lire le devis du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.quote.get({ id: quoteB.id })).rejects.toThrow();
  });

  it("isolation Facture : le garage A ne peut pas lire la facture du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.invoice.get({ id: invoiceB.id })).rejects.toThrow();
  });

  it("isolation Liste Véhicules : la liste du garage A ne contient aucun véhicule du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const list = await callerA.vehicle.list({ limit: 100 });
    expect(list.items.some((v) => v.id === vehicleB.id)).toBe(false);
  });

  it("isolation Client : le garage A ne peut pas lire le client du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.customer.get({ id: customerB.id })).rejects.toThrow();
  });

  it("isolation RDV : le garage A ne peut pas lire le rendez-vous du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.appointment.get({ id: appointmentB.id })).rejects.toThrow();
  });

  it("isolation OR : le garage A ne peut pas lire l'ordre du garage B", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.repairOrder.get({ id: repairOrderB.id })).rejects.toThrow();
  });
});
