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

describe("holiday router (M15 étape 1.2)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Jours Fériés A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Jours Fériés B" } });

    const userA = await adminDb.user.create({
      data: { name: "Owner A", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    await adminDb.membership.create({
      data: { organizationId: orgA.id, userId: userA.id, role: "OWNER", siteIds: [] },
    });
    const tokenA = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: userA.id,
        token: tokenA,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: orgA.id,
        isPinSession: false,
      },
    });
    ownerA = { userId: userA.id, token: tokenA };

    const userB = await adminDb.user.create({
      data: { name: "Owner B", email: `${randomBytes(4).toString("hex")}@example.com` },
    });
    await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: userB.id, role: "OWNER", siteIds: [] },
    });
    const tokenB = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: userB.id,
        token: tokenB,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: orgB.id,
        isPinSession: false,
      },
    });
    ownerB = { userId: userB.id, token: tokenB };
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.holiday.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.session.deleteMany({
      where: { userId: { in: [ownerA.userId, ownerB.userId] } },
    });
    await adminDb.membership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerA.userId, ownerB.userId] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("holiday.seedYear pré-remplit les 10 fêtes fixes + 4 fêtes estimées pour 2027 (US-M15-04)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const created = await caller.holiday.seedYear({ year: 2027 });
    expect(created).toHaveLength(14);
    const easterMonday = created.find((h) => h.name === "Lundi de Pâques");
    expect(easterMonday?.date.toISOString().slice(0, 10)).toBe("2027-03-29");
    const estimated = created.filter((h) => h.isEstimated);
    expect(estimated).toHaveLength(4);
  });

  it("holiday.seedYear ne duplique pas les jours déjà présents (relance idempotente)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const createdAgain = await caller.holiday.seedYear({ year: 2027 });
    expect(createdAgain).toHaveLength(0);

    const list = await caller.holiday.list({ year: 2027 });
    expect(list).toHaveLength(14);
  });

  it("holiday.create refuse un doublon à la même date pour le même site (RG-M15-08)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    await expect(
      caller.holiday.create({ date: new Date("2027-01-01"), name: "Doublon" }),
    ).rejects.toThrow("existe déjà");
  });

  it("holiday.update modifie le nom et journalise holiday.updated", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const list = await caller.holiday.list({ year: 2027 });
    const target = list.find((h) => h.name === "Toussaint")!;

    const updated = await caller.holiday.update({
      holidayId: target.id,
      name: "Toussaint (jour férié légal)",
    });
    expect(updated.name).toBe("Toussaint (jour férié légal)");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "holiday.updated", entityId: target.id },
    });
    expect(log).not.toBeNull();
  });

  it("holiday.delete supprime une fermeture exceptionnelle et journalise holiday.deleted", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const closure = await caller.holiday.create({
      date: new Date("2027-06-15"),
      name: "Inventaire annuel",
      kind: "CLOSURE",
    });

    await caller.holiday.delete({ holidayId: closure.id });

    const list = await caller.holiday.list({ year: 2027 });
    expect(list.find((h) => h.id === closure.id)).toBeUndefined();

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "holiday.deleted", entityId: closure.id },
    });
    expect(log).not.toBeNull();
  });

  it("isolation multi-locataire : holiday.list ne retourne que les jours fériés de l'organisation appelante", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const listB = await callerB.holiday.list({ year: 2027 });
    expect(listB).toHaveLength(0);
  });
});
