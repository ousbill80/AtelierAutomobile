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

describe("org router (M01)", () => {
  let org: { id: string };
  let ownerUser: { id: string };
  let ownerToken: string;
  let advisorUser: { id: string };
  let advisorToken: string;

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Org Test" } });

    ownerUser = await adminDb.user.create({
      data: {
        name: "Owner Org Test",
        email: `owner-org-${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: org.id, userId: ownerUser.id, role: "OWNER", siteIds: [] },
    });
    ownerToken = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: ownerUser.id,
        token: ownerToken,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: org.id,
        isPinSession: false,
      },
    });

    advisorUser = await adminDb.user.create({
      data: {
        name: "Advisor Org Test",
        email: `advisor-org-${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: org.id, userId: advisorUser.id, role: "ADVISOR", siteIds: [] },
    });
    advisorToken = randomBytes(32).toString("hex");
    await adminDb.session.create({
      data: {
        userId: advisorUser.id,
        token: advisorToken,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        activeOrganizationId: org.id,
        isPinSession: false,
      },
    });
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: { in: [ownerUser.id, advisorUser.id] } } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: { in: [ownerUser.id, advisorUser.id] } } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("org.get retourne les champs de l'organisation pour un OWNER (org:read)", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const result = await caller.org.get();
    expect(result.id).toBe(org.id);
    expect(result.name).toBe("Garage Org Test");
  });

  it("org.update modifie l'identité du garage et journalise org.updated", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const updated = await caller.org.update({
      name: "Garage Org Test Renommé",
      phone: "+2250102030405",
    });
    expect(updated.name).toBe("Garage Org Test Renommé");
    expect(updated.phone).toBe("+2250102030405");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "org.updated" },
    });
    expect(log).not.toBeNull();
    expect(log?.entityId).toBe(org.id);
  });

  it("org.update refuse un ADVISOR sans la permission org:update", async () => {
    const caller = callerFactory(await contextFor(advisorToken));
    await expect(caller.org.update({ name: "Tentative interdite" })).rejects.toThrow(
      "Permission manquante",
    );
  });

  it("org.setOperatingMode bascule en REMINDERS_ONLY et journalise org.operating_mode_changed (US-M15-10)", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const updated = await caller.org.setOperatingMode({
      mode: "REMINDERS_ONLY",
      reason: "Garage encore sur son ancien logiciel",
    });
    expect(updated.operatingMode).toBe("REMINDERS_ONLY");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "org.operating_mode_changed" },
    });
    expect(log).not.toBeNull();
    expect(log?.reason).toBe("Garage encore sur son ancien logiciel");

    // Remise à FULL pour ne pas perturber les autres assertions du fichier.
    await caller.org.setOperatingMode({ mode: "FULL", reason: "Retour en gestion complète" });
  });

  it("org.setOperatingMode refuse le passage en FULL si une source M13 est encore active (RG-M15-23)", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    await caller.org.setOperatingMode({ mode: "REMINDERS_ONLY", reason: "Test" });

    const dataSource = await adminDb.dataSource.create({
      data: {
        organizationId: org.id,
        type: "FILE_UPLOAD",
        name: "Export mensuel",
        config: "{}",
        isActive: true,
      },
    });

    await expect(
      caller.org.setOperatingMode({ mode: "FULL", reason: "Retour en gestion complète" }),
    ).rejects.toThrow(/assistant de migration/);

    await adminDb.dataSource.delete({ where: { id: dataSource.id } });
    await caller.org.setOperatingMode({ mode: "FULL", reason: "Retour en gestion complète" });
  });
});
