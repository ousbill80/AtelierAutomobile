import { TRPCError } from "@trpc/server";
import {
  assertCanCancelDeletion,
  canSwitchOperatingMode,
  isDomainError,
  planDeletion,
  type OrgLifecycleStatus,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  requestDeletionInputSchema,
  setOperatingModeInputSchema,
  updateOrgInputSchema,
} from "@atelieros/validators";
import { assertSensitiveActionOtp, sendSensitiveActionOtp } from "../auth/sensitive-otp";
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

  // M15 §10 — OTP frais exigé pour l'export complet et la suppression du compte.
  sendSecurityCode: requirePermission("settings:billing").mutation(async ({ ctx }) => {
    return sendSensitiveActionOtp(ctx.user.id, new Date());
  }),

  // US-M15-09 / RG-M15-22 — suppression programmée à J+30 (lecture seule, annulable).
  requestDeletion: requirePermission("settings:billing")
    .input(requestDeletionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { name: true, lifecycleStatus: true },
      });
      const pendingFneInvoices = await db
        .forTenant({ organizationId: ctx.organizationId })
        .invoice.count({ where: { fneStatus: "PENDING" } });
      let schedule: { requestedAt: Date; scheduledFor: Date };
      try {
        schedule = planDeletion({
          status: org.lifecycleStatus as OrgLifecycleStatus,
          organizationName: org.name,
          confirmName: input.confirmName,
          pendingFneInvoices,
          now,
        });
      } catch (error) {
        if (isDomainError(error)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
      await assertSensitiveActionOtp(ctx.user.id, input.otp, now);

      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: {
          lifecycleStatus: "DELETION_SCHEDULED",
          deletionRequestedAt: schedule.requestedAt,
          deletionScheduledFor: schedule.scheduledFor,
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "org.deletion_requested",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { lifecycleStatus: org.lifecycleStatus },
        after: {
          lifecycleStatus: "DELETION_SCHEDULED",
          deletionScheduledFor: schedule.scheduledFor.toISOString(),
        },
        reason: input.reason || "Suppression du compte demandée par le gérant (OTP vérifié).",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { scheduledFor: schedule.scheduledFor };
    }),

  cancelDeletion: requirePermission("settings:billing").mutation(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { lifecycleStatus: true, deletionScheduledFor: true },
    });
    try {
      assertCanCancelDeletion(org.lifecycleStatus as OrgLifecycleStatus);
    } catch (error) {
      if (isDomainError(error)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
      }
      throw error;
    }
    await adminDb.organization.update({
      where: { id: ctx.organizationId },
      data: { lifecycleStatus: "ACTIVE", deletionRequestedAt: null, deletionScheduledFor: null },
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "org.deletion_cancelled",
      entity: "Organization",
      entityId: ctx.organizationId,
      before: {
        lifecycleStatus: "DELETION_SCHEDULED",
        deletionScheduledFor: org.deletionScheduledFor?.toISOString() ?? null,
      },
      after: { lifecycleStatus: "ACTIVE" },
      reason: "Suppression du compte annulée.",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }),
});
