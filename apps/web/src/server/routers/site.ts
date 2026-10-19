import { TRPCError } from "@trpc/server";
import { canAddSite, validateOpeningHours } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  createSiteInputSchema,
  deactivateSiteInputSchema,
  updateSiteInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { withDomainErrors } from "../domain-error";

const OPEN_REPAIR_ORDER_STATUSES = [
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
] as const;

export const siteRouter = router({
  list: requirePermission("site:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.site.findMany({
      include: { bays: true },
      orderBy: { name: "asc" },
    });
  }),

  create: requirePermission("site:manage")
    .input(createSiteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const activeSiteCount = await tenantDb.site.count({ where: { isActive: true } });
      if (!canAddSite(org.plan, activeSiteCount)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            org.plan === "STARTER"
              ? "Passez à l'offre PRO pour gérer plusieurs ateliers."
              : "Limite de sites atteinte pour votre offre actuelle.",
        });
      }

      const existingCode = await tenantDb.site.findFirst({ where: { code: input.code } });
      if (existingCode) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Le code ${input.code} est déjà utilisé par un autre site.`,
        });
      }

      if (input.openingHours) {
        withDomainErrors(() => validateOpeningHours(input.openingHours!));
      }

      const site = await tenantDb.site.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          code: input.code,
          address: input.address,
          commune: input.commune,
          phone: input.phone,
          whatsappNumber: input.whatsappNumber,
          openingHours: input.openingHours ?? {},
          bays: {
            create: input.bays.map((bay) => ({
              name: bay.name,
              type: bay.type,
              organizationId: ctx.organizationId,
            })),
          },
        },
        include: { bays: true },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: site.id,
        action: "site.created",
        entity: "Site",
        entityId: site.id,
        after: site,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return site;
    }),

  update: requirePermission("site:manage")
    .input(updateSiteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.site.findUniqueOrThrow({
        where: { id: input.siteId },
        include: { bays: true },
      });

      if (input.code && input.code !== before.code) {
        // RG-M15-05 : le code n'est plus modifiable dès qu'il a servi à numéroter un document
        // (DocumentSequence créée pour ce site).
        const usedInNumbering = await tenantDb.documentSequence.count({
          where: { siteId: input.siteId },
        });
        if (usedInNumbering > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Le code du site ne peut plus être modifié : il est déjà utilisé dans la numérotation des documents.",
          });
        }

        const existingCode = await tenantDb.site.findFirst({ where: { code: input.code } });
        if (existingCode) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Le code ${input.code} est déjà utilisé par un autre site.`,
          });
        }
      }

      if (input.openingHours) {
        withDomainErrors(() => validateOpeningHours(input.openingHours!));
      }

      const newBays = (input.bays ?? []).filter((bay) => !bay.id);
      const existingBays = (input.bays ?? []).filter(
        (bay): bay is typeof bay & { id: string } => !!bay.id,
      );

      const site = await tenantDb.site.update({
        where: { id: input.siteId },
        data: {
          name: input.name,
          code: input.code,
          address: input.address,
          commune: input.commune,
          phone: input.phone,
          whatsappNumber: input.whatsappNumber,
          openingHours: input.openingHours,
          bays: {
            update: existingBays.map((bay) => ({
              where: { id: bay.id },
              data: { name: bay.name, type: bay.type, isActive: bay.isActive },
            })),
            create: newBays.map((bay) => ({
              name: bay.name,
              type: bay.type,
              organizationId: ctx.organizationId,
            })),
          },
        },
        include: { bays: true },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: site.id,
        action: "site.updated",
        entity: "Site",
        entityId: site.id,
        before,
        after: site,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return site;
    }),

  deactivate: requirePermission("site:manage")
    .input(deactivateSiteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.site.findUniqueOrThrow({ where: { id: input.siteId } });

      const openCount = await tenantDb.repairOrder.count({
        where: { siteId: input.siteId, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openCount > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ce site a ${openCount} OR ouverts. Clôturez-les ou transférez-les avant de le désactiver.`,
        });
      }

      // RG-M15-05 : refusé s'il reste du stock > 0 sur ce site.
      const stockTotal = await tenantDb.stockLevel.aggregate({
        where: { siteId: input.siteId },
        _sum: { onHand: true },
      });
      if ((stockTotal._sum.onHand ?? 0) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ce site a du stock restant (${stockTotal._sum.onHand} unités). Transférez le stock avant de le désactiver.`,
        });
      }

      // RG-M15-05 : refusé si une caisse est encore ouverte sur ce site.
      const openCashSession = await tenantDb.cashSession.findFirst({
        where: { siteId: input.siteId, closedAt: null },
      });
      if (openCashSession) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Une caisse est encore ouverte sur ce site. Clôturez-la avant de désactiver.",
        });
      }

      const site = await tenantDb.site.update({
        where: { id: input.siteId },
        data: { isActive: false },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: site.id,
        action: "site.deactivated",
        entity: "Site",
        entityId: site.id,
        before,
        after: site,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return site;
    }),
});
