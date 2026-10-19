import { TRPCError } from "@trpc/server";
import { DEFAULT_ROLE_PERMISSIONS, isKnownPermission, PERMISSIONS, ROLES } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  resetRoleDefaultsInputSchema,
  updateRolePermissionsInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

const NON_OWNER_ROLES = ROLES.filter((role) => role !== "OWNER");

export const roleRouter = router({
  getMatrix: requirePermission("role:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const overrides = await tenantDb.rolePermission.findMany();
    const overridesByRole = new Map(overrides.map((row) => [row.role, row.permissions]));

    return {
      permissions: PERMISSIONS,
      roles: NON_OWNER_ROLES.map((role) => ({
        role,
        permissions: overridesByRole.get(role) ?? DEFAULT_ROLE_PERMISSIONS[role],
        isCustomized: overridesByRole.has(role),
      })),
    };
  }),

  updatePermissions: requirePermission("role:manage")
    .input(updateRolePermissionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Le rôle OWNER dispose toujours de toutes les permissions.",
        });
      }

      const unknown = input.permissions.filter((p) => !isKnownPermission(p));
      if (unknown.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Permission(s) inconnue(s) : ${unknown.join(", ")}`,
        });
      }

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.rolePermission.findFirst({ where: { role: input.role } });

      const after = await tenantDb.rolePermission.upsert({
        where: { organizationId_role: { organizationId: ctx.organizationId, role: input.role } },
        create: {
          organizationId: ctx.organizationId,
          role: input.role,
          permissions: input.permissions,
          updatedById: ctx.user.id,
        },
        update: { permissions: input.permissions, updatedById: ctx.user.id },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "role.permissions_changed",
        entity: "RolePermission",
        entityId: after.id,
        before: { permissions: before?.permissions ?? DEFAULT_ROLE_PERMISSIONS[input.role] },
        after: { permissions: after.permissions },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  resetDefaults: requirePermission("role:manage")
    .input(resetRoleDefaultsInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.role === "OWNER") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Le rôle OWNER dispose toujours de toutes les permissions.",
        });
      }

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.rolePermission.findFirst({ where: { role: input.role } });
      if (before) {
        await tenantDb.rolePermission.delete({ where: { id: before.id } });
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "role.permissions_changed",
        entity: "RolePermission",
        entityId: before?.id ?? input.role,
        before: { permissions: before?.permissions ?? null },
        after: { permissions: DEFAULT_ROLE_PERMISSIONS[input.role] },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { role: input.role, permissions: DEFAULT_ROLE_PERMISSIONS[input.role] };
    }),
});
