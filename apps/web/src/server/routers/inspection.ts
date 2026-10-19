// M04 §8 — inspection multipoints (US-M04-06/07) et modèles d'inspection (RG-M04-16).
import { TRPCError } from "@trpc/server";
import {
  categoryResults,
  decideLineApproval,
  inspectionCompletedMessage,
  isLockedStatus,
  laborLinePricing,
  lineAmounts,
  statusAfterInspection,
  summarizeInspection,
  type InspectionTemplateItem,
} from "@atelieros/core";
import { db, type Prisma, type ScopedTenantClient } from "@atelieros/db";
import {
  bulkOkInputSchema,
  completeInspectionInputSchema,
  inspectionIdInputSchema,
  inspectionTemplateInputSchema,
  saveInspectionItemInputSchema,
  startInspectionInputSchema,
  updateInspectionTemplateInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { emitDomainEvent } from "../events/emit";
import {
  applyTransition,
  assertRoModule,
  badRequest,
  loadOrgRoContext,
  notFound,
  notify,
  recomputeTotals,
  roNow,
} from "../repairOrders/helpers";
import { preAuthorizedTotal } from "../repairOrders/lines";
import { orgProcedure, requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

async function loadInspection(tx: Tx, ctx: OrgCtx, inspectionId: string) {
  const inspection = await tx.inspection.findFirst({
    where: { id: inspectionId },
    include: { items: { orderBy: { sortOrder: "asc" } }, template: { select: { name: true } } },
  });
  if (!inspection) notFound("Inspection introuvable.");
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: inspection.repairOrderId } });
  requireSite(ctx, order.siteId);
  return { inspection, order };
}

function templateItems(value: Prisma.JsonValue): InspectionTemplateItem[] {
  return Array.isArray(value) ? (value as unknown as InspectionTemplateItem[]) : [];
}

const performProcedure = requirePermission("inspection:perform");

export const inspectionRouter = router({
  get: requirePermission("repair_order:read")
    .input(inspectionIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const { inspection, order } = await loadInspection(tx, ctx, input.inspectionId);
        return {
          ...inspection,
          order: { id: order.id, number: order.number, status: order.status },
          categories: categoryResults(inspection.items),
          summary: summarizeInspection(inspection.items),
        };
      });
    }),

  start: performProcedure.input(startInspectionInputSchema).mutation(async ({ ctx, input }) => {
    const org = await loadOrgRoContext(ctx.organizationId);
    assertRoModule(org);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    return tenantDb.transaction(async (tx) => {
      const order = await tx.repairOrder.findFirst({ where: { id: input.repairOrderId } });
      if (!order) notFound();
      requireSite(ctx, order.siteId);
      if (isLockedStatus(order.status) || order.status === "DRAFT") {
        badRequest("L'inspection se fait sur un véhicule réceptionné et non restitué.");
      }
      const open = await tx.inspection.findFirst({
        where: { repairOrderId: order.id, completedAt: null },
      });
      if (open) return { id: open.id };
      const template = input.templateId
        ? await tx.inspectionTemplate.findFirst({ where: { id: input.templateId, isActive: true } })
        : ((await tx.inspectionTemplate.findFirst({
            where: { isActive: true, isDefault: true },
          })) ??
          (await tx.inspectionTemplate.findFirst({
            where: { isActive: true },
            orderBy: { name: "asc" },
          })));
      if (!template) badRequest("Aucun modèle d'inspection : créez-en un dans les paramètres.");
      const inspection = await tx.inspection.create({
        data: {
          organizationId: ctx.organizationId,
          repairOrderId: order.id,
          templateId: template.id,
          performedById: ctx.membership.id,
          items: {
            create: templateItems(template.items).map((item, index) => ({
              organizationId: ctx.organizationId,
              category: item.category,
              label: item.label,
              result: "NOT_CHECKED",
              sortOrder: index,
            })),
          },
        },
      });
      // §5 start_diagnosis : automatique quand un mécanicien démarre l'inspection.
      if (order.status === "CHECKED_IN") {
        await applyTransition(tx, {
          order,
          to: "DIAGNOSING",
          transition: "start_diagnosis",
          membershipId: null,
          now,
        });
      }
      return { id: inspection.id };
    });
  }),

  saveItem: performProcedure
    .input(saveInspectionItemInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const item = await tx.inspectionItem.findFirst({ where: { id: input.itemId } });
        if (!item) notFound("Point d'inspection introuvable.");
        const { inspection } = await loadInspection(tx, ctx, item.inspectionId);
        if (inspection.completedAt) badRequest("L'inspection est terminée.");
        return tx.inspectionItem.update({
          where: { id: item.id },
          data: {
            result: input.result,
            measurement: input.measurement,
            comment: input.comment,
            photoUrls: input.photoAttachmentIds?.map((id) => `/api/attachments/${id}`),
            recommendedProductIds: input.recommendedProductIds,
            recommendedLaborIds: input.recommendedLaborIds,
            shareWithCustomer: input.shareWithCustomer,
          },
        });
      });
    }),

  /** « Tout OK » : les points non renseignés de la catégorie passent OK. */
  bulkOk: performProcedure.input(bulkOkInputSchema).mutation(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.transaction(async (tx) => {
      const { inspection } = await loadInspection(tx, ctx, input.inspectionId);
      if (inspection.completedAt) badRequest("L'inspection est terminée.");
      const { count } = await tx.inspectionItem.updateMany({
        where: { inspectionId: inspection.id, category: input.category, result: "NOT_CHECKED" },
        data: { result: "OK" },
      });
      return { updated: count };
    });
  }),

  complete: performProcedure
    .input(completeInspectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const { inspection, order } = await loadInspection(tx, ctx, input.inspectionId);
        if (inspection.completedAt) badRequest("L'inspection est déjà terminée.");
        const summary = summarizeInspection(inspection.items);
        const updated = await tx.inspection.update({
          where: { id: inspection.id },
          data: {
            completedAt: now,
            performedById: inspection.performedById ?? ctx.membership.id,
            summary: summary as unknown as Prisma.InputJsonValue,
          },
        });
        let orStatus = order.status;
        const next = statusAfterInspection(order.status, summary);
        if (next !== order.status) {
          // US-M04-06 : DIAGNOSING → AWAITING_APPROVAL (transition système request_approval).
          const moved = await applyTransition(tx, {
            order,
            to: next,
            transition: "request_approval",
            reason: "Inspection terminée",
            membershipId: null,
            now,
          });
          orStatus = moved.status;
        }
        await notify(tx, ctx.organizationId, [order.advisorId], {
          type: "inspection.completed",
          title: inspectionCompletedMessage(order.number, summary),
          link: `/ordres/${order.id}`,
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "inspection.completed", {
          inspectionId: inspection.id,
          repairOrderId: order.id,
          summary,
        });
        return { inspection: updated, summary, orStatus };
      });
    }),

  /**
   * Transforme les recommandations des points URGENT/WATCH en lignes d'OR en attente d'accord
   * (passerelle vers le devis M05 : `quote.createFromInspection` reprendra ces items).
   */
  addRecommendationsToOrder: requirePermission("repair_order:update")
    .input(inspectionIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const { inspection, order } = await loadInspection(tx, ctx, input.inspectionId);
        if (isLockedStatus(order.status)) badRequest("L'OR est clôturé.");
        const items = inspection.items.filter(
          (i) =>
            (i.result === "URGENT" || i.result === "WATCH") &&
            !i.addedToQuote &&
            (i.recommendedLaborIds.length > 0 || i.recommendedProductIds.length > 0),
        );
        const ceiling =
          ((order.checkIn ?? {}) as { authorizationCeiling?: number }).authorizationCeiling ?? 0;
        let sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
        let created = 0;
        for (const item of items) {
          const [ops, products] = await Promise.all([
            tx.laborOperation.findMany({ where: { id: { in: item.recommendedLaborIds } } }),
            tx.product.findMany({ where: { id: { in: item.recommendedProductIds } } }),
          ]);
          const drafts = [
            ...ops.map((op) => {
              const pricing = laborLinePricing(op, org.laborRates);
              return {
                type: "LABOR" as const,
                laborOperationId: op.id,
                productId: null,
                description: op.name,
                quantity: pricing.quantity,
                unitPrice: pricing.unitPrice,
                vatRate: org.vatEnabled ? org.vatRate : 0,
              };
            }),
            ...products.map((p) => ({
              type: "PART" as const,
              laborOperationId: null,
              productId: p.id,
              description: p.name,
              quantity: 1,
              unitPrice: p.salePrice,
              vatRate: org.vatEnabled ? p.vatRate : 0,
            })),
          ];
          for (const draft of drafts) {
            const total = lineAmounts(
              {
                ...draft,
                discountRate: 0,
                status: "PENDING",
                approval: "PENDING",
                payer: "CUSTOMER",
              },
              org.vatEnabled,
            ).total;
            const decision = decideLineApproval({
              payer: "CUSTOMER",
              phase: "AFTER_CHECK_IN",
              authorizationCeiling: ceiling,
              preAuthorizedTotal: await preAuthorizedTotal(tx, order.id, org.vatEnabled),
              lineTotal: total,
            });
            await tx.repairOrderLine.create({
              data: {
                organizationId: ctx.organizationId,
                repairOrderId: order.id,
                ...draft,
                ...decision,
                inspectionItemId: item.id,
                sortOrder: sortOrder++,
              },
            });
            created += 1;
          }
          await tx.inspectionItem.update({ where: { id: item.id }, data: { addedToQuote: true } });
        }
        const totals = await recomputeTotals(tx, order.id, org.vatEnabled);
        return { created, totals };
      });
    }),
});

export const inspectionTemplateRouter = router({
  list: orgProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (
        !ctx.permissions.has("inspection:perform") &&
        !ctx.permissions.has("inspection:template_manage")
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permission manquante : inspection:perform",
        });
      }
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const templates = await tenantDb.inspectionTemplate.findMany({
        where: input?.includeArchived ? {} : { isActive: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      });
      return templates.map((t) => ({ ...t, items: templateItems(t.items) }));
    }),

  create: requirePermission("inspection:template_manage")
    .input(inspectionTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        if (input.isDefault) {
          await tx.inspectionTemplate.updateMany({ where: {}, data: { isDefault: false } });
        }
        return tx.inspectionTemplate.create({
          data: {
            organizationId: ctx.organizationId,
            name: input.name,
            items: input.items as unknown as Prisma.InputJsonValue,
            isDefault: Boolean(input.isDefault),
          },
        });
      });
    }),

  update: requirePermission("inspection:template_manage")
    .input(updateInspectionTemplateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const existing = await tx.inspectionTemplate.findFirst({ where: { id: input.id } });
        if (!existing) notFound("Modèle introuvable.");
        if (input.isDefault) {
          await tx.inspectionTemplate.updateMany({ where: {}, data: { isDefault: false } });
        }
        return tx.inspectionTemplate.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            items: input.items ? (input.items as unknown as Prisma.InputJsonValue) : undefined,
            isDefault: input.isDefault,
          },
        });
      });
    }),

  duplicate: requirePermission("inspection:template_manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.inspectionTemplate.findFirst({ where: { id: input.id } });
      if (!existing) notFound("Modèle introuvable.");
      return tenantDb.inspectionTemplate.create({
        data: {
          organizationId: ctx.organizationId,
          name: `${existing.name} (copie)`,
          items: existing.items as Prisma.InputJsonValue,
        },
      });
    }),

  archive: requirePermission("inspection:template_manage")
    .input(z.object({ id: z.string().min(1), archived: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.inspectionTemplate.findFirst({ where: { id: input.id } });
      if (!existing) notFound("Modèle introuvable.");
      return tenantDb.inspectionTemplate.update({
        where: { id: existing.id },
        data: { isActive: !input.archived, ...(input.archived ? { isDefault: false } : {}) },
      });
    }),
});
