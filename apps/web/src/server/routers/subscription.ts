import { TRPCError } from "@trpc/server";
import {
  assertExportAllowed,
  downgradeImpact,
  isDomainError,
  isExportExpired,
  isSupportAccessActive,
  PLAN_CATALOG,
  PLAN_TIERS,
  planRank,
  resolvePlan,
  supportAccessUntil,
  usageLevel,
  type LimitKey,
  type PlanTier,
} from "@atelieros/core";
import { adminDb, computePlanUsage, db, GAUGE_KEYS } from "@atelieros/db";
import { resolveSubscriptionProvider } from "@atelieros/integrations";
import {
  dataExportRequestInputSchema,
  grantSupportAccessInputSchema,
  requestPlanChangeInputSchema,
} from "@atelieros/validators";
import { assertSensitiveActionOtp } from "../auth/sensitive-otp";
import { writeAuditLog } from "../audit";
import { enqueueOrgExportJob } from "../plan/exportQueue";
import { requirePermission, router } from "../trpc";

// M15 §8 — `plan.*` (US-M15-07, RG-M15-19/20), `dataExport.*` (US-M15-08, RG-M15-21) et
// `support.*` (RG-M15-27). Toutes réservées à `settings:billing` (OWNER).

function domainToTrpc(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

export const planRouter = router({
  get: requirePermission("settings:billing").query(async ({ ctx }) => {
    const now = new Date();
    const { ctx: planCtx, usage } = await computePlanUsage(ctx.organizationId, now);
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { plan: true, lifecycleStatus: true },
    });
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const [lastRequest, lastChange] = await Promise.all([
      tenantDb.auditLog.findFirst({
        where: { action: "plan.change_requested" },
        orderBy: { createdAt: "desc" },
      }),
      tenantDb.auditLog.findFirst({
        where: { action: "plan.changed" },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const pending =
      lastRequest &&
      (lastRequest.after as { status?: string } | null)?.status === "PENDING" &&
      (!lastChange || lastChange.createdAt < lastRequest.createdAt)
        ? {
            targetPlan: (lastRequest.after as { targetPlan?: PlanTier }).targetPlan ?? null,
            requestedAt: lastRequest.createdAt,
          }
        : null;

    return {
      plan: org.plan as PlanTier,
      lifecycleStatus: org.lifecycleStatus,
      gauges: GAUGE_KEYS.map((key) => {
        const limit = planCtx.plan.quotas[key as keyof typeof planCtx.plan.quotas] as number | null;
        return { key, used: usage[key], limit, level: usageLevel(usage[key], limit) };
      }),
      features: planCtx.plan.features,
      quotas: planCtx.plan.quotas,
      catalog: PLAN_TIERS.map((tier) => PLAN_CATALOG[tier]),
      pendingRequest: pending,
    };
  }),

  requestChange: requirePermission("settings:billing")
    .input(requestPlanChangeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { id: true, name: true, plan: true, planOverrides: true },
      });
      const current = org.plan as PlanTier;
      if (input.targetPlan === current) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Vous êtes déjà sur l'offre ${current}.`,
        });
      }

      const { usage } = await computePlanUsage(ctx.organizationId, now);
      const impact =
        planRank(input.targetPlan) < planRank(current)
          ? downgradeImpact(resolvePlan(input.targetPlan, org.planOverrides), usage)
          : [];

      const user = await adminDb.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { name: true, email: true, phone: true },
      });
      let provider;
      try {
        provider = resolveSubscriptionProvider({
          provider: process.env.SUBSCRIPTION_BILLING_PROVIDER,
          allowSimulator: process.env.APP_ENV !== "production",
        });
      } catch (error) {
        domainToTrpc(error);
      }
      const result = await provider.requestPlanChange({
        organizationId: org.id,
        organizationName: org.name,
        currentPlan: current,
        targetPlan: input.targetPlan,
        requestedBy: user,
        message: input.message,
        idempotencyKey: `${org.id}:${input.targetPlan}:${now.getTime()}`,
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "plan.change_requested",
        entity: "Organization",
        entityId: ctx.organizationId,
        before: { plan: current },
        after: {
          targetPlan: input.targetPlan,
          status: result.status,
          reference: result.reference,
          provider: provider.name,
        },
        reason: input.message ?? null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      if (result.status === "APPLIED") {
        await adminDb.organization.update({
          where: { id: ctx.organizationId },
          data: { plan: input.targetPlan },
        });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "plan.changed",
          entity: "Organization",
          entityId: ctx.organizationId,
          before: { plan: current },
          after: { plan: input.targetPlan, reference: result.reference },
          reason: input.message ?? `Changement d'offre ${current} → ${input.targetPlan}`,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      return {
        status: result.status,
        plan: result.status === "APPLIED" ? input.targetPlan : current,
        downgradeImpact: impact as { key: LimitKey; used: number; limit: number; excess: number }[],
      };
    }),
});

export const dataExportRouter = router({
  request: requirePermission("settings:billing")
    .input(dataExportRequestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const previous = await tenantDb.dataExport.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { createdAt: true, status: true },
      });
      try {
        assertExportAllowed({ previous, now });
      } catch (error) {
        domainToTrpc(error);
      }
      await assertSensitiveActionOtp(ctx.user.id, input.otp, now);

      const created = await tenantDb.dataExport.create({
        data: {
          organizationId: ctx.organizationId,
          requestedById: ctx.membership.id,
          status: "PENDING",
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "org.export",
        entity: "DataExport",
        entityId: created.id,
        after: { status: "PENDING" },
        reason: "Export complet des données demandé (OTP vérifié).",
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await enqueueOrgExportJob(ctx.organizationId, created.id);
      return { exportId: created.id };
    }),

  list: requirePermission("settings:billing").query(async ({ ctx }) => {
    const now = new Date();
    const rows = await db.forTenant({ organizationId: ctx.organizationId }).dataExport.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    // `fileUrl` (clé S3) n'est jamais renvoyé : le téléchargement passe par /api/exports/{id}.
    return rows.map((row) => {
      const expired = row.status === "EXPIRED" || isExportExpired(row.expiresAt, now);
      return {
        id: row.id,
        status: row.status === "READY" && expired ? "EXPIRED" : row.status,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
        expiresAt: row.expiresAt,
        sizeBytes: row.sizeBytes,
        tableCount: row.tableCount,
        rowCount: row.rowCount,
        error: row.error,
        downloadable: row.status === "READY" && !expired,
      };
    });
  }),
});

export const supportRouter = router({
  get: requirePermission("settings:billing").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { supportAccessUntil: true },
    });
    return {
      until: org.supportAccessUntil,
      active: isSupportAccessActive(org.supportAccessUntil, new Date()),
    };
  }),

  grantAccess: requirePermission("settings:billing")
    .input(grantSupportAccessInputSchema)
    .mutation(async ({ ctx, input }) => {
      let until: Date;
      try {
        until = supportAccessUntil(new Date(), input.hours);
      } catch (error) {
        domainToTrpc(error);
      }
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { supportAccessUntil: until },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "support.access_granted",
        entity: "Organization",
        entityId: ctx.organizationId,
        after: { supportAccessUntil: until.toISOString() },
        reason: `Accès support autorisé pendant ${input.hours} h.`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { until };
    }),

  revokeAccess: requirePermission("settings:billing").mutation(async ({ ctx }) => {
    await adminDb.organization.update({
      where: { id: ctx.organizationId },
      data: { supportAccessUntil: null },
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "support.access_revoked",
      entity: "Organization",
      entityId: ctx.organizationId,
      reason: "Accès support retiré.",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }),
});
