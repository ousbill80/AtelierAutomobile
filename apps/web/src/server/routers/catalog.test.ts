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
  const membership = await adminDb.membership.create({
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
  return { userId: user.id, membershipId: membership.id, token };
}

describe("catalog router (M02)", () => {
  let orgA: { id: string };
  let ownerA: { userId: string; membershipId: string; token: string };

  let orgB: { id: string };
  let ownerB: { userId: string; membershipId: string; token: string };

  let globalMake: { id: string };

  const userIds: string[] = [];
  const makeIds: string[] = [];

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Catalogue A", plan: "PRO" } });
    ownerA = await ownerContextFor(orgA.id, "Owner Catalogue A");
    userIds.push(ownerA.userId);

    orgB = await adminDb.organization.create({ data: { name: "Garage Catalogue B", plan: "PRO" } });
    ownerB = await ownerContextFor(orgB.id, "Owner Catalogue B");
    userIds.push(ownerB.userId);

    globalMake = await adminDb.vehicleMake.create({
      data: { organizationId: null, name: `GlobalMake-${randomBytes(3).toString("hex")}` },
    });
    makeIds.push(globalMake.id);
  });

  afterAll(async () => {
    const orgIds = [orgA.id, orgB.id];
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.vehicleModel.deleteMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { makeId: { in: makeIds } }] },
    });
    await adminDb.vehicleMake.deleteMany({
      where: { OR: [{ organizationId: { in: orgIds } }, { id: { in: makeIds } }] },
    });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: orgIds } } });
  });

  it("catalog.makes renvoie le catalogue global pour toutes les organisations", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const makes = await callerA.catalog.makes({});
    expect(makes.map((m) => m.id)).toContain(globalMake.id);
  });

  it("catalog.addLocalModel crée une marque/modèle local visible uniquement pour son organisation", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const callerB = callerFactory(await contextFor(ownerB.token));
    const localMakeName = `MarqueLocale-${randomBytes(3).toString("hex")}`;

    const result = await callerA.catalog.addLocalModel({
      make: localMakeName,
      model: "ModeleX",
      serviceIntervalKm: 10000,
    });
    expect(result.make.name).toBe(localMakeName);
    expect(result.model.name).toBe("ModeleX");
    expect(result.model.serviceIntervalKm).toBe(10000);
    makeIds.push(result.make.id);

    const log = await adminDb.auditLog.findFirst({
      where: {
        organizationId: orgA.id,
        action: "catalog.local_model_added",
        entityId: result.model.id,
      },
    });
    expect(log).not.toBeNull();

    const makesA = await callerA.catalog.makes({});
    expect(makesA.map((m) => m.id)).toContain(result.make.id);

    const makesB = await callerB.catalog.makes({});
    expect(makesB.map((m) => m.id)).not.toContain(result.make.id);

    const modelsA = await callerA.catalog.models({ makeId: result.make.id });
    expect(modelsA.map((m) => m.id)).toContain(result.model.id);
  });

  it("catalog.addLocalModel réutilise la marque locale existante (upsert) sans la dupliquer", async () => {
    const callerA = callerFactory(await contextFor(ownerA.token));
    const localMakeName = `MarqueReutilisee-${randomBytes(3).toString("hex")}`;

    const first = await callerA.catalog.addLocalModel({ make: localMakeName, model: "Variante1" });
    makeIds.push(first.make.id);
    const second = await callerA.catalog.addLocalModel({ make: localMakeName, model: "Variante2" });

    expect(second.make.id).toBe(first.make.id);
  });
});
