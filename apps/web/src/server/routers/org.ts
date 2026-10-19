import { TRPCError } from "@trpc/server";
import { canSwitchOperatingMode } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { setOperatingModeInputSchema, updateOrgInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

// Organization est la racine du tenant (pas de champ organizationId sur elle-même) :
// db.forTenant ne s'applique pas à ce modèle, adminDb filtré explicitement par id est requis.
export const orgRouter = router({
  get: requirePermission("org:read").query(async ({ ctx }) => {
    return adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  }),

  update: requirePermission("org:update")
    .input(updateOrgInputSchema)
    .mutation(async ({ ctx, input }) => {
      const before = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });

      const after = await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: input,
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "org.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  // RG-M15-23/US-M15-10 — bascule FULL ↔ REMINDERS_ONLY. Le passage en FULL avec une source
  // de synchronisation M13 encore active est refusé (assistant de migration non construit à
  // cette étape) ; REMINDERS_ONLY est toujours autorisé.
  setOperatingMode: requirePermission("settings:update")
    .input(setOperatingModeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const before = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const activeDataSourceCount = await tenantDb.dataSource.count({ where: { isActive: true } });

      const decision = canSwitchOperatingMode({
        from: before.operatingMode,
        to: input.mode,
        hasActiveDataSource: activeDataSourceCount > 0,
      });
      if (!decision.allowed) {
        throw new TRPCError({ code: "CONFLICT", message: decision.reason });
      }

      const after = await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { operatingMode: input.mode },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "org.operating_mode_changed",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { operatingMode: before.operatingMode },
        after: { operatingMode: after.operatingMode },
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),
});
