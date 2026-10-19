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

describe("member router (M01)", () => {
  let org: { id: string };
  let owner: { userId: string; membershipId: string; token: string };
  let manager: { userId: string; membershipId: string; token: string };
  let mechanic: { userId: string; membershipId: string; token: string };
  const userIds: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Member Test", plan: "PRO" } });
    owner = await memberContextFor(org.id, "Owner Member Test", "OWNER");
    manager = await memberContextFor(org.id, "Manager Member Test", "MANAGER");
    mechanic = await memberContextFor(org.id, "Mechanic Member Test", "MECHANIC");
    userIds.push(owner.userId, manager.userId, mechanic.userId);
  });

  afterAll(async () => {
    await adminDb.invitation.deleteMany({ where: { organizationId: org.id } });
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("member.list retourne les membres actifs de l'organisation", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const members = await caller.member.list({});
    expect(members.map((m) => m.id)).toContain(owner.membershipId);
    expect(members.map((m) => m.id)).toContain(manager.membershipId);
  });

  it("member.invite refuse un MANAGER qui invite un OWNER (RG-M01-12)", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    await expect(
      caller.member.invite({
        name: "Tentative Owner",
        email: `invite-${randomBytes(4).toString("hex")}@example.com`,
        role: "OWNER",
        siteIds: [],
        channel: "EMAIL",
      }),
    ).rejects.toThrow("Vous ne pouvez pas inviter ce rôle");
  });

  it("member.invite crée une invitation et journalise member.invited", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const email = `invite-${randomBytes(4).toString("hex")}@example.com`;
    const result = await caller.member.invite({
      name: "Nouveau Caissier",
      email,
      role: "CASHIER",
      siteIds: [],
      channel: "EMAIL",
    });
    expect(result.invitationId).toBeDefined();

    const invitation = await adminDb.invitation.findUniqueOrThrow({
      where: { id: result.invitationId },
    });
    expect(invitation.status).toBe("PENDING");

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "member.invited", entityId: result.invitationId },
    });
    expect(log).not.toBeNull();
  });

  it("member.update change le rôle et journalise member.role_changed", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const target = await memberContextFor(org.id, "A Promouvoir", "CASHIER");
    userIds.push(target.userId);

    const updated = await caller.member.update({
      membershipId: target.membershipId,
      role: "STOREKEEPER",
    });
    expect(updated.role).toBe("STOREKEEPER");

    const log = await adminDb.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "member.role_changed",
        entityId: target.membershipId,
      },
    });
    expect(log).not.toBeNull();
  });

  it("member.deactivate refuse de désactiver le dernier OWNER (RG-M01-11)", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    await expect(
      caller.member.deactivate({ membershipId: owner.membershipId, reason: "Test" }),
    ).rejects.toThrow("au moins un gérant");
  });

  it("member.deactivate puis member.reactivate fonctionnent pour un non-OWNER", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const deactivated = await caller.member.deactivate({
      membershipId: mechanic.membershipId,
      reason: "Fin de contrat",
    });
    expect(deactivated.isActive).toBe(false);

    const deactivatedLog = await adminDb.auditLog.findFirst({
      where: {
        organizationId: org.id,
        action: "member.deactivated",
        entityId: mechanic.membershipId,
      },
    });
    expect(deactivatedLog).not.toBeNull();

    const reactivated = await caller.member.reactivate({ membershipId: mechanic.membershipId });
    expect(reactivated.isActive).toBe(true);
  });

  it("member.setPin refuse un rôle non éligible et un PIN trivial", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const advisor = await memberContextFor(org.id, "Conseiller PIN", "ADVISOR");
    userIds.push(advisor.userId);

    await expect(
      caller.member.setPin({ membershipId: advisor.membershipId, pin: "7042" }),
    ).rejects.toThrow("n'est disponible que pour les rôles");

    await expect(
      caller.member.setPin({ membershipId: mechanic.membershipId, pin: "1234" }),
    ).rejects.toThrow("trop simple");
  });

  it("member.setPin accepte un PIN valide pour un rôle éligible", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const result = await caller.member.setPin({
      membershipId: mechanic.membershipId,
      pin: "7042",
    });
    expect(result.ok).toBe(true);

    const refreshed = await adminDb.membership.findUniqueOrThrow({
      where: { id: mechanic.membershipId },
    });
    expect(refreshed.pinHash).not.toBeNull();
  });

  it("member.revokeAllSessions supprime les sessions et journalise session.revoked", async () => {
    const caller = callerFactory(await contextFor(owner.token));
    const result = await caller.member.revokeAllSessions({ membershipId: mechanic.membershipId });
    expect(result.revokedCount).toBeGreaterThan(0);

    const remaining = await adminDb.session.findUnique({ where: { token: mechanic.token } });
    expect(remaining).toBeNull();

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "session.revoked", entityId: mechanic.membershipId },
    });
    expect(log).not.toBeNull();
  });
});
