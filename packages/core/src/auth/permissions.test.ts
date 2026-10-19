import { describe, expect, it } from "vitest";
import {
  canInviteRole,
  DEFAULT_ROLE_PERMISSIONS,
  isKnownPermission,
  PERMISSIONS,
  resolvePermissions,
} from "./permissions";

describe("resolvePermissions — RG-M01-08", () => {
  it("OWNER obtient tout le catalogue, quelles que soient les surcharges", () => {
    const result = resolvePermissions({ role: "OWNER" });
    expect(result.size).toBe(PERMISSIONS.length);
    expect(result.has("role:manage")).toBe(true);
  });

  it("un rôle sans surcharge utilise la matrice par défaut (§10.2)", () => {
    const result = resolvePermissions({ role: "MECHANIC" });
    expect([...result].sort()).toEqual([...DEFAULT_ROLE_PERMISSIONS.MECHANIC].sort());
    expect(result.has("stock:adjust")).toBe(false);
  });

  it("une surcharge RolePermission(org, role) remplace la matrice par défaut", () => {
    const result = resolvePermissions({
      role: "ADVISOR",
      organizationRolePermissions: ["customer:read"],
    });
    expect([...result]).toEqual(["customer:read"]);
  });

  it("un grant Membership.permissions ajoute une permission à la base", () => {
    const result = resolvePermissions({
      role: "ADVISOR",
      membershipOverrides: ["invoice:void"],
    });
    expect(result.has("invoice:void")).toBe(true);
    expect(result.has("customer:read")).toBe(true); // reste la base par défaut
  });

  it("un revoke (préfixe !) retire une permission accordée par défaut", () => {
    const result = resolvePermissions({
      role: "MANAGER",
      membershipOverrides: ["!stock:adjust"],
    });
    expect(result.has("stock:adjust")).toBe(false);
  });

  it("une permission inconnue est ignorée et journalisée via le callback", () => {
    const unknown: string[] = [];
    const result = resolvePermissions({
      role: "ADVISOR",
      organizationRolePermissions: ["customer:read", "bogus:perm"],
      membershipOverrides: ["also:bogus"],
      onUnknownPermission: (p) => unknown.push(p),
    });
    expect(result.has("customer:read" as never)).toBe(true);
    expect(unknown).toEqual(["bogus:perm", "also:bogus"]);
  });
});

describe("isKnownPermission", () => {
  it("reconnaît une permission du catalogue", () => {
    expect(isKnownPermission("org:read")).toBe(true);
    expect(isKnownPermission("nope:nope")).toBe(false);
  });
});

describe("canInviteRole — RG-M01-12", () => {
  it("un OWNER peut inviter n'importe quel rôle", () => {
    expect(canInviteRole("OWNER", "OWNER")).toBe(true);
    expect(canInviteRole("OWNER", "MANAGER")).toBe(true);
    expect(canInviteRole("OWNER", "ACCOUNTANT")).toBe(true);
    expect(canInviteRole("OWNER", "MECHANIC")).toBe(true);
  });

  it("un MANAGER ne peut inviter que des rôles inférieurs", () => {
    expect(canInviteRole("MANAGER", "MECHANIC")).toBe(true);
    expect(canInviteRole("MANAGER", "STOREKEEPER")).toBe(true);
    expect(canInviteRole("MANAGER", "CASHIER")).toBe(true);
    expect(canInviteRole("MANAGER", "ADVISOR")).toBe(true);
  });

  it("un MANAGER ne peut pas inviter OWNER, MANAGER ou ACCOUNTANT", () => {
    expect(canInviteRole("MANAGER", "OWNER")).toBe(false);
    expect(canInviteRole("MANAGER", "MANAGER")).toBe(false);
    expect(canInviteRole("MANAGER", "ACCOUNTANT")).toBe(false);
  });

  it("les autres rôles ne peuvent inviter personne", () => {
    expect(canInviteRole("ADVISOR", "MECHANIC")).toBe(false);
    expect(canInviteRole("MECHANIC", "MECHANIC")).toBe(false);
  });
});
