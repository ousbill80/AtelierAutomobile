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
  await adminDb.membership.create({
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
  return { userId: user.id, token };
}

describe("audit router (M01)", () => {
  let org: { id: string };
  let manager: { userId: string; token: string };
  let advisor: { userId: string; token: string };
  const userIds: string[] = [];

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Audit Test" } });
    manager = await memberContextFor(org.id, "Manager Audit Test", "MANAGER");
    advisor = await memberContextFor(org.id, "Advisor Audit Test", "ADVISOR");
    userIds.push(manager.userId, advisor.userId);

    for (let i = 0; i < 3; i++) {
      await adminDb.auditLog.create({
        data: {
          organizationId: org.id,
          action: "site.created",
          entity: "Site",
          entityId: `site-${i}`,
        },
      });
    }
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: { in: userIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.deleteMany({ where: { id: { in: userIds } } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("audit.list refuse un rôle sans la permission audit:read (ADVISOR)", async () => {
    const caller = callerFactory(await contextFor(advisor.token));
    await expect(caller.audit.list({ limit: 50 })).rejects.toThrow("Permission manquante");
  });

  it("audit.list pagine les résultats par curseur", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    const firstPage = await caller.audit.list({ limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await caller.audit.list({ limit: 2, cursor: firstPage.nextCursor });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("audit.export refuse quand aucune entrée ne correspond aux filtres", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    await expect(caller.audit.export({ action: "inconnu.action" })).rejects.toThrow(
      "Aucune entrée",
    );
  });

  it("audit.export génère un CSV encodé en data URL", async () => {
    const caller = callerFactory(await contextFor(manager.token));
    const result = await caller.audit.export({ action: "site.created" });
    expect(result.fileUrl).toMatch(/^data:text\/csv;base64,/);

    const base64 = result.fileUrl.slice("data:text/csv;base64,".length);
    const csv = Buffer.from(base64, "base64").toString("utf-8");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("createdAt,action,entity,entityId,userId,membershipId,siteId,reason");
    expect(lines).toHaveLength(4);
  });
});
