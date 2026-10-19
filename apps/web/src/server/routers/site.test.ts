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

describe("site router (M01)", () => {
  let starterOrg: { id: string };
  let starterSite: { id: string };
  let starterOwner: { userId: string; token: string };

  let proOrg: { id: string };
  let proOwner: { userId: string; token: string };

  beforeAll(async () => {
    starterOrg = await adminDb.organization.create({
      data: { name: "Garage Starter Test", plan: "STARTER" },
    });
    starterSite = await adminDb.site.create({
      data: { organizationId: starterOrg.id, name: "Site Starter", code: "STA" },
    });
    starterOwner = await ownerContextFor(starterOrg.id, "Owner Starter");

    proOrg = await adminDb.organization.create({ data: { name: "Garage Pro Test", plan: "PRO" } });
    proOwner = await ownerContextFor(proOrg.id, "Owner Pro");
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({
      where: { organizationId: { in: [starterOrg.id, proOrg.id] } },
    });
    await adminDb.session.deleteMany({
      where: { userId: { in: [starterOwner.userId, proOwner.userId] } },
    });
    await adminDb.membership.deleteMany({
      where: { organizationId: { in: [starterOrg.id, proOrg.id] } },
    });
    await adminDb.user.deleteMany({
      where: { id: { in: [starterOwner.userId, proOwner.userId] } },
    });
    await adminDb.site.deleteMany({
      where: { organizationId: { in: [starterOrg.id, proOrg.id] } },
    });
    await adminDb.organization.deleteMany({ where: { id: { in: [starterOrg.id, proOrg.id] } } });
  });

  it("site.list retourne les sites avec leurs ponts", async () => {
    const caller = callerFactory(await contextFor(starterOwner.token));
    const sites = await caller.site.list();
    expect(sites.map((s) => s.id)).toContain(starterSite.id);
  });

  it("site.create refuse un 2e site sur un plan STARTER (RG-M01-13)", async () => {
    const caller = callerFactory(await contextFor(starterOwner.token));
    await expect(
      caller.site.create({ name: "Site Starter 2", code: "ST2", bays: [] }),
    ).rejects.toThrow("Passez à l'offre PRO");
  });

  it("site.create crée un site avec ses ponts sur un plan PRO et journalise site.created", async () => {
    const caller = callerFactory(await contextFor(proOwner.token));
    const site = await caller.site.create({
      name: "Atelier Cocody",
      code: "COC",
      bays: [
        { name: "Pont 1", type: "LIFT" },
        { name: "Diagnostic", type: "DIAGNOSTIC" },
      ],
    });
    expect(site.code).toBe("COC");
    expect(site.bays).toHaveLength(2);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: proOrg.id, action: "site.created", entityId: site.id },
    });
    expect(log).not.toBeNull();
  });

  it("site.create refuse un code déjà utilisé dans la même organisation", async () => {
    const caller = callerFactory(await contextFor(proOwner.token));
    await expect(caller.site.create({ name: "Doublon", code: "COC", bays: [] })).rejects.toThrow(
      "est déjà utilisé par un autre site",
    );
  });

  it("site.update modifie les champs et gère les ponts (ajout + mise à jour)", async () => {
    const caller = callerFactory(await contextFor(proOwner.token));
    const created = await caller.site.create({
      name: "Atelier Yopougon",
      code: "YOP",
      bays: [{ name: "Pont 1", type: "LIFT" }],
    });
    const existingBay = created.bays[0]!;

    const updated = await caller.site.update({
      siteId: created.id,
      name: "Atelier Yopougon Centre",
      bays: [
        { id: existingBay.id, name: "Pont 1 rénové", type: "LIFT", isActive: true },
        { name: "Carrosserie", type: "BODYWORK", isActive: true },
      ],
    });

    expect(updated.name).toBe("Atelier Yopougon Centre");
    expect(updated.bays).toHaveLength(2);
    const renamedBay = updated.bays.find((b) => b.id === existingBay.id);
    expect(renamedBay?.name).toBe("Pont 1 rénové");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: proOrg.id, action: "site.updated", entityId: created.id },
    });
    expect(log).not.toBeNull();
  });

  it("site.deactivate refuse un site avec des OR ouverts puis réussit une fois clôturés", async () => {
    const caller = callerFactory(await contextFor(proOwner.token));
    const site = await caller.site.create({ name: "Atelier Abobo", code: "ABO", bays: [] });

    const customer = await adminDb.customer.create({
      data: { organizationId: proOrg.id, displayName: "Client Test Abobo" },
    });
    const vehicle = await adminDb.vehicle.create({
      data: {
        organizationId: proOrg.id,
        customerId: customer.id,
        plate: "1234AB01",
        make: "Toyota",
        model: "Corolla",
      },
    });
    const repairOrder = await adminDb.repairOrder.create({
      data: {
        organizationId: proOrg.id,
        siteId: site.id,
        number: "OR-ABO-2026-00001",
        customerId: customer.id,
        vehicleId: vehicle.id,
        status: "IN_PROGRESS",
      },
    });

    await expect(caller.site.deactivate({ siteId: site.id })).rejects.toThrow("OR ouverts");

    await adminDb.repairOrder.update({
      where: { id: repairOrder.id },
      data: { status: "DELIVERED" },
    });

    const deactivated = await caller.site.deactivate({ siteId: site.id });
    expect(deactivated.isActive).toBe(false);

    await adminDb.repairOrder.delete({ where: { id: repairOrder.id } });
    await adminDb.vehicle.delete({ where: { id: vehicle.id } });
    await adminDb.customer.delete({ where: { id: customer.id } });
  });
});
