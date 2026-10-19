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
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
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

describe("customer router (M02)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };
  let customerB: { id: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Customer Test A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Customer Test B" } });
    ownerA = await ownerContextFor(orgA.id, "Owner A");
    ownerB = await ownerContextFor(orgB.id, "Owner B");
    customerB = await adminDb.customer.create({
      data: { organizationId: orgB.id, displayName: "Client B", type: "INDIVIDUAL" },
    });
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.reminder.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.reminderRule.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.invoice.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.vehicle.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.customer.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("isolation : customer.get sur un ID d'une autre organisation échoue", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await expect(callerA.customer.get({ id: customerB.id })).rejects.toThrow();
  });

  it("isolation : customer.list ne renvoie jamais les clients d'une autre organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const result = await callerA.customer.list({ limit: 100 });
    expect(result.items.some((c) => c.id === customerB.id)).toBe(false);
  });

  it("customer.create normalise le téléphone et calcule displayName (RG-M02-01, RG-M02-03)", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const { customer } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "kouassi",
      firstName: "jean-marc",
      phone: "07 47 21 88 90",
    });
    expect(customer.displayName).toBe("Kouassi Jean-Marc");
    expect(customer.phone).toBe("+2250747218890");
  });

  it("customer.create bloque un doublon ≥ 80 (même téléphone) sans motif, autorise avec motif (US-M02-01)", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Traoré",
      firstName: "Moussa",
      phone: "07 00 11 22 33",
    });

    await expect(
      callerA.customer.create({
        type: "INDIVIDUAL",
        lastName: "Traoré",
        firstName: "Moussa",
        phone: "07 00 11 22 33",
      }),
    ).rejects.toThrow(/appartient déjà/);

    const { customer: created } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Traoré",
      firstName: "Moussa",
      phone: "07 00 11 22 33",
      duplicateOverrideReason: "numéro partagé",
    });
    expect(created.id).toBeDefined();
  });

  it("customer.setConsent — doNotRemind annule les relances planifiées (RG-M02-15)", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const { customer } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Litige",
      firstName: "Client",
    });
    const rule = await adminDb.reminderRule.create({
      data: {
        organizationId: orgA.id,
        type: "INSPECTION",
        name: "Règle test",
        steps: [],
        sendWindow: {},
        stopOn: [],
      },
    });
    const reminder = await adminDb.reminder.create({
      data: {
        organizationId: orgA.id,
        ruleId: rule.id,
        type: "INSPECTION",
        stepKey: "J-30",
        customerId: customer.id,
        dueDate: new Date(),
        scheduledFor: new Date(),
        status: "PLANNED",
        dedupeKey: `test:${customer.id}`,
      },
    });

    await callerA.customer.setConsent({
      id: customer.id,
      doNotRemind: true,
      reason: "Client en litige",
      source: "staff",
    });

    const updatedReminder = await adminDb.reminder.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(updatedReminder.status).toBe("CANCELLED");
  });

  it("customer.merge réaffecte les véhicules et ferme le client source (RG-M02-08)", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const { customer: source } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Kone",
      firstName: "Ibrahim",
    });
    const { customer: target } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Koné",
      firstName: "Ibrahim",
      email: "koneibrahim@example.com",
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: orgA.id,
        customerId: source.id,
        plate: "9999 ZZ 01",
        plateCompact: "9999ZZ01",
        make: "Peugeot",
        model: "301",
      },
    });

    const result = await callerA.customer.merge({
      sourceId: source.id,
      targetId: target.id,
      fieldChoices: {},
      confirmName: source.displayName,
    });

    expect(result.targetId).toBe(target.id);
    expect(result.moved.vehicle).toBe(1);

    const movedVehicle = await adminDb.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    expect(movedVehicle.customerId).toBe(target.id);

    const deletedSource = await adminDb.customer.findUniqueOrThrow({ where: { id: source.id } });
    expect(deletedSource.deletedAt).not.toBeNull();
    expect(deletedSource.mergedIntoId).toBe(target.id);
  });

  it("customer.merge refuse si le nom de confirmation ne correspond pas", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const { customer: source } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Diabate",
      firstName: "Awa",
    });
    const { customer: target } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Diabate2",
      firstName: "Awa",
    });

    await expect(
      callerA.customer.merge({
        sourceId: source.id,
        targetId: target.id,
        fieldChoices: {},
        confirmName: "Un autre nom",
      }),
    ).rejects.toThrow(/ne correspond pas/);
  });

  it("customer.delete refuse un client avec impayés (RG-M02-18)", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const { customer } = await callerA.customer.create({
      type: "INDIVIDUAL",
      lastName: "Impaye",
      firstName: "Client",
    });
    const site = await adminDb.site.create({
      data: {
        organizationId: orgA.id,
        name: "Site Test",
        code: `ST${randomBytes(2).toString("hex")}`,
      },
    });
    await adminDb.invoice.create({
      data: {
        organizationId: orgA.id,
        siteId: site.id,
        customerId: customer.id,
        status: "ISSUED",
        total: 185000,
      },
    });

    await expect(callerA.customer.delete({ id: customer.id, reason: "test" })).rejects.toThrow(
      "impayés",
    );
  });
});
