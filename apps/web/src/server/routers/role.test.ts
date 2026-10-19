import { randomBytes } from "node:crypto";
import { computeSessionAbsoluteExpiry, DEFAULT_ROLE_PERMISSIONS } from "@atelieros/core";
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

describe("role router (M01)", () => {
  let org: { id: string };
  let ownerUser: { id: string };
  let ownerToken: string;

  beforeAll(async () => {
    org = await adminDb.organization.create({ data: { name: "Garage Role Test" } });
    ownerUser = await adminDb.user.create({
      data: {
        name: "Owner Role Test",
        email: `owner-role-${randomBytes(4).toString("hex")}@example.com`,
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
  });

  afterAll(async () => {
    await adminDb.auditLog.deleteMany({ where: { organizationId: org.id } });
    await adminDb.rolePermission.deleteMany({ where: { organizationId: org.id } });
    await adminDb.session.deleteMany({ where: { userId: ownerUser.id } });
    await adminDb.membership.deleteMany({ where: { organizationId: org.id } });
    await adminDb.user.delete({ where: { id: ownerUser.id } });
    await adminDb.organization.delete({ where: { id: org.id } });
  });

  it("role.getMatrix retourne la matrice par défaut sans personnalisation", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const matrix = await caller.role.getMatrix();
    expect(matrix.roles.map((r) => r.role)).not.toContain("OWNER");
    const cashier = matrix.roles.find((r) => r.role === "CASHIER")!;
    expect(cashier.isCustomized).toBe(false);
    expect(cashier.permissions).toEqual(DEFAULT_ROLE_PERMISSIONS.CASHIER);
  });

  it("role.updatePermissions refuse le rôle OWNER", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    await expect(
      caller.role.updatePermissions({ role: "OWNER", permissions: ["org:read"] }),
    ).rejects.toThrow("dispose toujours de toutes les permissions");
  });

  it("role.updatePermissions refuse une permission inconnue", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    await expect(
      caller.role.updatePermissions({ role: "CASHIER", permissions: ["bogus:permission"] }),
    ).rejects.toThrow("Permission(s) inconnue(s)");
  });

  it("role.updatePermissions personnalise un rôle et journalise role.permissions_changed", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const updated = await caller.role.updatePermissions({
      role: "CASHIER",
      permissions: ["org:read", "payment:create"],
    });
    expect(updated.permissions).toEqual(["org:read", "payment:create"]);

    const matrix = await caller.role.getMatrix();
    const cashier = matrix.roles.find((r) => r.role === "CASHIER")!;
    expect(cashier.isCustomized).toBe(true);

    const log = await adminDb.auditLog.findFirst({
      where: { organizationId: org.id, action: "role.permissions_changed", entityId: updated.id },
    });
    expect(log).not.toBeNull();
  });

  it("role.resetDefaults supprime la personnalisation", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    const reset = await caller.role.resetDefaults({ role: "CASHIER" });
    expect(reset.permissions).toEqual(DEFAULT_ROLE_PERMISSIONS.CASHIER);

    const matrix = await caller.role.getMatrix();
    const cashier = matrix.roles.find((r) => r.role === "CASHIER")!;
    expect(cashier.isCustomized).toBe(false);
  });

  it("role.resetDefaults refuse le rôle OWNER", async () => {
    const caller = callerFactory(await contextFor(ownerToken));
    await expect(caller.role.resetDefaults({ role: "OWNER" })).rejects.toThrow(
      "dispose toujours de toutes les permissions",
    );
  });
});
