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

describe("session / me routers (M01)", () => {
  let orgA: { id: string };
  let orgB: { id: string };
  let siteX: { id: string };
  let siteY: { id: string };
  let siteB: { id: string };
  let user: { id: string };
  let token: string;

  beforeAll(async () => {
    orgA = await adminDb.organization.create({ data: { name: "Garage A Test" } });
    orgB = await adminDb.organization.create({ data: { name: "Garage B Test" } });
    siteX = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site X", code: "SX" },
    });
    siteY = await adminDb.site.create({
      data: { organizationId: orgA.id, name: "Site Y", code: "SY" },
    });
    siteB = await adminDb.site.create({
      data: { organizationId: orgB.id, name: "Site B", code: "SB" },
    });

    user = await adminDb.user.create({
      data: {
        name: "Test Session",
        email: `test-session-${randomBytes(4).toString("hex")}@example.com`,
      },
    });
    await adminDb.membership.create({
      data: { organizationId: orgA.id, userId: user.id, role: "MANAGER", siteIds: [] },
    });
    await adminDb.membership.create({
      data: { organizationId: orgB.id, userId: user.id, role: "ADVISOR", siteIds: [siteB.id] },
    });

    token = randomBytes(32).toString("hex");
    const now = new Date();
    await adminDb.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: computeSessionAbsoluteExpiry(now, false),
        activeOrganizationId: orgA.id,
        activeSiteId: siteX.id,
        isPinSession: false,
        deviceId: "device-session-test",
        lastActiveAt: now,
      },
    });
  });

  afterAll(async () => {
    await adminDb.session.deleteMany({ where: { userId: user.id } });
    await adminDb.membership.deleteMany({ where: { userId: user.id } });
    await adminDb.user.delete({ where: { id: user.id } });
    await adminDb.site.deleteMany({ where: { organizationId: { in: [orgA.id, orgB.id] } } });
    await adminDb.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });

  it("me.get retourne les organisations, l'organisation active et les sites autorisés", async () => {
    const caller = callerFactory(await contextFor(token));
    const me = await caller.me.get();

    expect(me.organizations.map((o) => o.id).sort()).toEqual([orgA.id, orgB.id].sort());
    expect(me.activeOrganization?.id).toBe(orgA.id);
    expect(me.membership?.role).toBe("MANAGER");
    expect(me.permissions).toContain("customer:read");
    expect(me.allowedSites.map((s) => s.id).sort()).toEqual([siteX.id, siteY.id].sort());
  });

  it("session.list expose la session courante", async () => {
    const caller = callerFactory(await contextFor(token));
    const sessions = await caller.session.list();
    const current = sessions.find((s) => s.current);
    expect(current).toBeDefined();
    expect(current?.device).toBe("device-session-test");
  });

  it("setActiveOrganization bascule vers l'organisation B et choisit son unique site", async () => {
    const caller = callerFactory(await contextFor(token));
    await caller.session.setActiveOrganization({ organizationId: orgB.id });

    const row = await adminDb.session.findUniqueOrThrow({ where: { token } });
    expect(row.activeOrganizationId).toBe(orgB.id);
    expect(row.activeSiteId).toBe(siteB.id);

    const refreshedUser = await adminDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshedUser.lastActiveOrganizationId).toBe(orgB.id);

    // setActiveSite(null) refusé : un seul site autorisé sur B (RG-M01-10).
    const ctxB = await contextFor(token);
    await expect(callerFactory(ctxB).session.setActiveSite({ siteId: null })).rejects.toThrow(
      "deux sites",
    );

    // Retour sur A pour les tests suivants.
    await callerFactory(await contextFor(token)).session.setActiveOrganization({
      organizationId: orgA.id,
    });
  });

  it("setActiveSite change de site puis autorise « Tous les sites » sur l'organisation A (2 sites)", async () => {
    const ctxA = await contextFor(token);
    await callerFactory(ctxA).session.setActiveSite({ siteId: siteY.id });
    let row = await adminDb.session.findUniqueOrThrow({ where: { token } });
    expect(row.activeSiteId).toBe(siteY.id);

    await callerFactory(await contextFor(token)).session.setActiveSite({ siteId: null });
    row = await adminDb.session.findUniqueOrThrow({ where: { token } });
    expect(row.activeSiteId).toBeNull();

    // Remet un site concret pour ne pas affecter d'autres tests dépendant de activeSiteId.
    await callerFactory(await contextFor(token)).session.setActiveSite({ siteId: siteX.id });
  });

  it("setActiveSite refuse un site hors du périmètre de la membership", async () => {
    const ctxA = await contextFor(token);
    await expect(callerFactory(ctxA).session.setActiveSite({ siteId: siteB.id })).rejects.toThrow();
  });

  it("session.revoke refuse de révoquer la session d'un autre utilisateur", async () => {
    const otherUser = await adminDb.user.create({
      data: { name: "Autre", email: `other-${randomBytes(4).toString("hex")}@example.com` },
    });
    const otherToken = randomBytes(32).toString("hex");
    const otherSession = await adminDb.session.create({
      data: {
        userId: otherUser.id,
        token: otherToken,
        expiresAt: computeSessionAbsoluteExpiry(new Date(), false),
        isPinSession: false,
      },
    });

    const caller = callerFactory(await contextFor(token));
    await expect(caller.session.revoke({ sessionId: otherSession.id })).rejects.toThrow(
      "Session introuvable.",
    );

    await adminDb.session.deleteMany({ where: { userId: otherUser.id } });
    await adminDb.user.delete({ where: { id: otherUser.id } });
  });
});
