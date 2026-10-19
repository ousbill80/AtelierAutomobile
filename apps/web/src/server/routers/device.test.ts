import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);

async function contextFor(token: string | null) {
  const req = new Request("http://localhost/api/trpc", {
    headers: token ? { cookie: `atelieros_session=${token}` } : {},
  });
  return createContext({ req, resHeaders: new Headers(), info: undefined as never });
}

async function memberContextFor(organizationId: string, name: string, role: string) {
  const user = await adminDb.user.create({
    data: { name, email: `${randomBytes(4).toString("hex")}@example.com` },
  });
  const membership = await adminDb.membership.create({
    data: { organizationId, userId: user.id, role: role as never, siteIds: [] },
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

describe("device.registerShared + auth.pinSignIn (M01)", () => {
  let org: { id: string };
  let owner: { userId: string; membershipId: string; token: string };
  let mechanic: { userId: string; membershipId: string; token: string };
  let advisor: { userId: string; membershipId: string; token: string };
  const userIds: string[] = [];
  const deviceId = `tablette-${randomBytes(4).toString("hex")}`;

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Device Test" } });
    owner = await memberContextFor(org.id, "Owner Device Test", "OWNER");
    mechanic = await memberContextFor(org.id, "Mechanic Device Test", "MECHANIC");
    advisor = await memberContextFor(org.id, "Advisor Device Test", "ADVISOR");
    userIds.push(owner.userId, mechanic.userId, advisor.userId);
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.trustedDevice.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("auth.pinSignIn refuse un appareil non enregistré", async () => {
    const caller = callerFactory(await contextFor(null));
    await expect(
      caller.auth.pinSignIn({
        deviceId: "appareil-inconnu",
        membershipId: mechanic.membershipId,
        pin: "7042",
      }),
    ).rejects.toThrow("n'est pas enregistré");
  });

  it("device.registerShared enregistre une tablette partagée", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const result = await caller.device.registerShared({ deviceId, label: "Tablette atelier 1" });
    expect(result.ok).toBe(true);

    const device = await adminDb.trustedDevice.findUniqueOrThrow({ where: { deviceId } });
    expect(device.isSharedWorkshopDevice).toBe(true);
    expect(device.organizationId).toBe(org.id);
  });

  it("auth.pinSignIn refuse un rôle non éligible (ADVISOR)", async () => {
    await adminDb.membership.update({
      where: { id: advisor.membershipId },
      data: { pinHash: "$argon2id$dummy" },
    });
    const caller = callerFactory(await contextFor(null));
    await expect(
      caller.auth.pinSignIn({ deviceId, membershipId: advisor.membershipId, pin: "7042" }),
    ).rejects.toThrow("non autorisée");
  });

  it("auth.pinSignIn refuse quand aucun PIN n'est défini", async () => {
    const caller = callerFactory(await contextFor(null));
    await expect(
      caller.auth.pinSignIn({ deviceId, membershipId: mechanic.membershipId, pin: "7042" }),
    ).rejects.toThrow("Aucun code PIN");
  });

  it("auth.pinSignIn réussit avec un PIN valide et ouvre une session PIN de 12h", async () => {
    await callerFactory(await contextFor(owner.token)).member.setPin({
      membershipId: mechanic.membershipId,
      pin: "7042",
    });

    const ctx = await contextFor(null);
    const caller = callerFactory(ctx);
    const result = await caller.auth.pinSignIn({
      deviceId,
      membershipId: mechanic.membershipId,
      pin: "7042",
    });
    expect(result.ok).toBe(true);
    expect(ctx.resHeaders.get("set-cookie")).toContain("atelieros_session=");

    const session = await adminDb.session.findFirst({
      where: { userId: mechanic.userId, isPinSession: true },
    });
    expect(session).not.toBeNull();
    expect(session?.activeOrganizationId).toBe(org.id);

    const log = await adminDb.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "auth.login.success",
        entityId: mechanic.membershipId,
      },
    });
    expect(log).not.toBeNull();
  });

  it("auth.pinSignIn bloque après 5 échecs", async () => {
    const target = await memberContextFor(org.id, "Storekeeper PIN Lock", "STOREKEEPER");
    userIds.push(target.userId);
    await callerFactory(await contextFor(owner.token)).member.setPin({
      membershipId: target.membershipId,
      pin: "7042",
    });

    for (let i = 0; i < 5; i++) {
      await expect(
        callerFactory(await contextFor(null)).auth.pinSignIn({
          deviceId,
          membershipId: target.membershipId,
          pin: "0000",
        }),
      ).rejects.toThrow();
    }

    await expect(
      callerFactory(await contextFor(null)).auth.pinSignIn({
        deviceId,
        membershipId: target.membershipId,
        pin: "7042",
      }),
    ).rejects.toThrow("bloqué");
  });
});
