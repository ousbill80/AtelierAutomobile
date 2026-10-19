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

describe("settings router (M15 étape 1.2, RG-M15-02)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let ownerA: { userId: string; token: string };
  let ownerB: { userId: string; token: string };
  let advisorA: { userId: string; token: string };

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage Paramètres A" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage Paramètres B" } });

    const userA = await adminDb.user.create({
      data: { name: "Owner Paramètres A", email: `${randomBytes(4).toString("hex")}@example.com` },
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

    const advisorUserA = await adminDb.user.create({
      data: {
        name: "Advisor Paramètres A",
        email: `${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: orgA.id, userId: advisorUserA.id, role: "ADVISOR", siteIds: [] },
    });
    const advisorTokenA = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: advisorUserA.id,
        token: advisorTokenA,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: orgA.id,
        isPinSession: false,
      },
    });
    advisorA = { userId: advisorUserA.id, token: advisorTokenA };

    const userB = await adminDb.user.create({
      data: { name: "Owner Paramètres B", email: `${randomBytes(4).toString("hex")}@example.com` },
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
    await adminDb.session.deleteMany({
      where: { userId: { in: [ownerA.userId, ownerB.userId, advisorA.userId] } },
    });
    await adminDb.membership.deleteMany({
      where: { organizationId: { in: [orgA.id, orgB.id] } },
    });
    await adminDb.user.deleteMany({
      where: { id: { in: [ownerA.userId, ownerB.userId, advisorA.userId] } },
    });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("settings.get renvoie les valeurs par défaut de la TVA (RG-M15-02)", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const result = await caller.settings.get({});
    expect(result.tax).toEqual({ rates: [18, 9, 0], rounding: "PER_LINE" });
  });

  it("settings.get est accessible en lecture à un ADVISOR (settings:read)", async () => {
    const caller = callerFactory(await contextFor(advisorA.token));
    const result = await caller.settings.get({});
    expect(result.tax.rates).toEqual([18, 9, 0]);
  });

  it("settings.update modifie le mode d'arrondi et journalise settings.updated", async () => {
    const caller = callerFactory(await contextFor(ownerA.token));
    const updated = await caller.settings.update({
      section: "tax",
      values: { rounding: "PER_DOCUMENT" },
    });
    expect(updated.tax).toEqual({ rates: [18, 9, 0], rounding: "PER_DOCUMENT" });

    const refetched = await caller.settings.get({});
    expect(refetched.tax.rounding).toBe("PER_DOCUMENT");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: orgA.id, action: "settings.updated" },
    });
    expect(log).not.toBeNull();
  });

  it("settings.update refuse un ADVISOR sans la permission settings:update", async () => {
    const caller = callerFactory(await contextFor(advisorA.token));
    await expect(
      caller.settings.update({ section: "tax", values: { rounding: "PER_LINE" } }),
    ).rejects.toThrow("Permission manquante");
  });

  it("isolation multi-locataire : la modification d'une organisation n'affecte pas une autre", async () => {
    const callerB = callerFactory(await contextFor(ownerB.token));
    const result = await callerB.settings.get({});
    expect(result.tax).toEqual({ rates: [18, 9, 0], rounding: "PER_LINE" });
  });
});
