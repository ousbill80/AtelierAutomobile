// M04 §8 — routeur `repairOrderLine` : ajout, modification (verrou optimiste), retrait,
// statut (utilisé par M06), affectation, suivi de sous-traitance.
import { TRPCError } from "@trpc/server";
import {
  decideLineApproval,
  hasSkill,
  isLockedStatus,
  isWorkableLine,
  lineAmounts,
} from "@atelieros/core";
import {
  db,
  issueReservedForLine,
  loadStockContext,
  syncRepairOrderStock,
  type RepairOrder,
  type RepairOrderLine,
  type ScopedTenantClient,
} from "@atelieros/db";
import {
  addLineInputSchema,
  assignLineInputSchema,
  removeLineInputSchema,
  setLineStatusInputSchema,
  setSubcontractStatusInputSchema,
  updateLineInputSchema,
} from "@atelieros/validators";
import { z } from "zod";
import { writeAuditLog } from "../audit";
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
  syncOrderStock,
} from "../repairOrders/helpers";
import {
  afterLineChange,
  buildLineData,
  preAuthorizedTotal,
  recordDeclinedRecommendation,
} from "../repairOrders/lines";
import { orgProcedure, requirePermission, requireSite, router } from "../trpc";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

function lockedError(): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "LINE_LOCKED : l'OR est restitué ou clôturé, ses lignes ne sont plus modifiables.",
  });
}

async function loadLine(
  tx: Tx,
  ctx: OrgCtx,
  id: string,
): Promise<{ line: RepairOrderLine; order: RepairOrder }> {
  const line = await tx.repairOrderLine.findFirst({ where: { id } });
  if (!line) notFound("Ligne introuvable.");
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: line.repairOrderId } });
  requireSite(ctx, order.siteId);
  return { line, order };
}

function canEditLines(ctx: OrgCtx): boolean {
  return ctx.permissions.has("repair_order:update") || ctx.permissions.has("inspection:perform");
}

export const repairOrderLineRouter = router({
  add: orgProcedure
    .input(addLineInputSchema.extend({ priceReason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (!canEditLines(ctx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permission manquante : repair_order:update",
        });
      }
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const order = await tx.repairOrder.findFirst({ where: { id: input.repairOrderId } });
        if (!order) notFound();
        requireSite(ctx, order.siteId);
        if (isLockedStatus(order.status)) lockedError();
        const customer = await tx.customer.findFirstOrThrow({ where: { id: order.customerId } });
        const { repairOrderId: _ignored, priceReason, ...line } = input;
        void _ignored;
        const data = await buildLineData(tx, ctx, org, order, customer, line, priceReason);
        const total = lineAmounts(
          {
            type: data.type,
            quantity: data.quantity,
            unitPrice: data.unitPrice,
            discountRate: data.discountRate ?? 0,
            vatRate: data.vatRate,
            status: "PENDING",
            approval: "PENDING",
            payer: data.payer ?? "CUSTOMER",
            isCustomerSupplied: data.isCustomerSupplied,
          },
          org.vatEnabled,
        ).total;
        const checkIn = (order.checkIn ?? {}) as { authorizationCeiling?: number };
        const decision =
          order.status === "DRAFT"
            ? data.payer === "WARRANTY" || data.payer === "INTERNAL"
              ? { approval: "NOT_REQUIRED" as const, approvalSource: null }
              : { approval: "PENDING" as const, approvalSource: "CHECK_IN" as const }
            : decideLineApproval({
                payer: data.payer ?? "CUSTOMER",
                phase: "AFTER_CHECK_IN",
                authorizationCeiling: checkIn.authorizationCeiling ?? 0,
                preAuthorizedTotal: await preAuthorizedTotal(tx, order.id, org.vatEnabled),
                lineTotal: total,
              });
        const sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
        const created = await tx.repairOrderLine.create({
          data: { ...data, ...decision, sortOrder },
        });
        await emitDomainEvent(tx as never, ctx.organizationId, "repair_order.line_added", {
          repairOrderId: order.id,
          lineId: created.id,
          approval: created.approval,
        });
        const totals = await recomputeTotals(tx, order.id, org.vatEnabled);
        // M07 : une pièce ajoutée à un OR déjà approuvé est réservée aussitôt.
        await syncOrderStock(tx, order, roNow(), ctx.membership.id);
        return { line: created, totals };
      });
    }),

  update: orgProcedure.input(updateLineInputSchema).mutation(async ({ ctx, input }) => {
    if (!canEditLines(ctx)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permission manquante : repair_order:update",
      });
    }
    const org = await loadOrgRoContext(ctx.organizationId);
    assertRoModule(org);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    return tenantDb.transaction(async (tx) => {
      const { line, order } = await loadLine(tx, ctx, input.id);
      if (isLockedStatus(order.status)) lockedError();
      if (
        input.expectedUpdatedAt &&
        line.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cette ligne a été modifiée par un autre utilisateur. Rechargez.",
        });
      }
      const patch = { ...input.patch };
      if (patch.approval && !ctx.permissions.has("repair_order:update")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Permission manquante : repair_order:update",
        });
      }
      const nextSupplied = patch.isCustomerSupplied ?? line.isCustomerSupplied;
      if (line.type === "PART" && nextSupplied) patch.unitPrice = 0;
      if (patch.unitPrice !== undefined && line.productId && !nextSupplied) {
        const product = await tx.product.findFirst({ where: { id: line.productId } });
        if (product?.minSalePrice != null && patch.unitPrice < product.minSalePrice) {
          if (!ctx.permissions.has("invoice:price_below_min")) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
            });
          }
          if (!input.reason?.trim()) badRequest("Indiquez le motif du prix sous le minimum.");
          await writeAuditLog({
            organizationId: ctx.organizationId,
            userId: ctx.user.id,
            membershipId: ctx.membership.id,
            action: "repair_order.price_below_min",
            entity: "RepairOrder",
            entityId: order.id,
            before: { unitPrice: line.unitPrice },
            after: { unitPrice: patch.unitPrice, minSalePrice: product.minSalePrice },
            reason: input.reason,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
      const { approvalSource, ...rest } = patch;
      const data = {
        ...rest,
        ...(patch.approval === "APPROVED"
          ? { approvalSource: approvalSource ?? "IN_PERSON" }
          : patch.approval === "DECLINED"
            ? { cancelReason: "Refusée par le client" }
            : {}),
        ...(patch.payer === "WARRANTY" || patch.payer === "INTERNAL"
          ? { approval: "NOT_REQUIRED" as const }
          : {}),
      };
      const updated = await tx.repairOrderLine.update({ where: { id: line.id }, data });
      if (patch.approval === "DECLINED" && line.approval !== "DECLINED") {
        await recordDeclinedRecommendation(
          tx,
          org,
          order,
          line,
          lineAmounts(line, org.vatEnabled).total,
          now,
        );
      }
      if (patch.approval) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: `repair_order.line_${patch.approval.toLowerCase()}`,
          entity: "RepairOrder",
          entityId: order.id,
          after: { lineId: line.id, approval: patch.approval, source: approvalSource ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      const totals = await recomputeTotals(tx, order.id, org.vatEnabled);
      await afterLineChange(tx, ctx, org, order.id, now);
      return { line: updated, totals };
    });
  }),

  remove: requirePermission("repair_order:update")
    .input(removeLineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const { line, order } = await loadLine(tx, ctx, input.id);
        if (isLockedStatus(order.status)) lockedError();
        const timeEntries = await tx.timeEntry.count({ where: { repairOrderLineId: line.id } });
        // Jamais approuvée ni pointée → suppression ; sinon annulation tracée (§8).
        if (line.approval === "PENDING" && timeEntries === 0) {
          await tx.repairOrderLine.delete({ where: { id: line.id } });
        } else {
          await tx.repairOrderLine.update({
            where: { id: line.id },
            data: { status: "CANCELLED", cancelReason: input.reason ?? null },
          });
        }
        const totals = await recomputeTotals(tx, order.id, org.vatEnabled);
        await afterLineChange(tx, ctx, org, order.id, now);
        return { totals };
      });
    }),

  /** M06 : le mécanicien démarre / termine sa ligne. RG-M04-08 : jamais sur une ligne en attente. */
  setStatus: orgProcedure.input(setLineStatusInputSchema).mutation(async ({ ctx, input }) => {
    if (!canEditLines(ctx)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Permission manquante : inspection:perform",
      });
    }
    const org = await loadOrgRoContext(ctx.organizationId);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const now = roNow();
    return tenantDb.transaction(async (tx) => {
      const { line, order } = await loadLine(tx, ctx, input.id);
      if (isLockedStatus(order.status)) lockedError();
      if (input.status === "CANCELLED") badRequest("Utilisez « Retirer la ligne » pour l'annuler.");
      if (input.status !== "PENDING" && !isWorkableLine(line)) {
        badRequest("En attente d'accord client : cette ligne ne peut pas être travaillée.");
      }
      if (
        input.status !== "PENDING" &&
        !["APPROVED", "IN_PROGRESS", "WAITING_PARTS", "QUALITY_CHECK"].includes(order.status)
      ) {
        badRequest("L'OR doit être approuvé avant de commencer les travaux.");
      }
      const updated = await tx.repairOrderLine.update({
        where: { id: line.id },
        data: {
          status: input.status,
          completedAt: input.status === "DONE" ? now : null,
          completedById: input.status === "DONE" ? ctx.membership.id : null,
        },
      });
      if (input.status === "DONE" && line.status !== "DONE") {
        // RG-M04-09 : ligne validée → sortie des pièces réservées pour elle (ISSUE_TO_RO).
        const stock = await loadStockContext(ctx.organizationId);
        await syncRepairOrderStock(tx, stock, order.id, now, ctx.membership.id);
        await issueReservedForLine(tx, stock, line.id, now, ctx.membership.id);
      }
      await afterLineChange(tx, ctx, org, order.id, now);
      return updated;
    });
  }),

  assign: requirePermission("repair_order:assign")
    .input(assignLineInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const { line, order } = await loadLine(tx, ctx, input.id);
        if (isLockedStatus(order.status)) lockedError();
        let skillWarning: string | null = null;
        if (input.membershipId) {
          const member = await tx.membership.findFirst({
            where: { id: input.membershipId, isActive: true },
            include: { user: { select: { name: true } } },
          });
          if (!member) badRequest("Mécanicien introuvable.");
          // M06 US-M06-03 : avertissement non bloquant si la compétence requise manque.
          const op = line.laborOperationId
            ? await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } })
            : null;
          if (op?.requiredSkill && !hasSkill(member.skills, op.requiredSkill)) {
            skillWarning = `${member.user.name} n'a pas la compétence ${op.requiredSkill}`;
          }
        }
        const updated = await tx.repairOrderLine.update({
          where: { id: line.id },
          data: { assignedToId: input.membershipId },
        });
        // M06 US-M06-03 : le mécanicien reçoit une notification (tablette à la prochaine synchro).
        if (input.membershipId && input.membershipId !== line.assignedToId) {
          await notify(tx, ctx.organizationId, [input.membershipId], {
            type: "workshop.task_assigned",
            title: `Nouvelle tâche — ${order.number} : ${line.description}`,
            link: "/tablette/taches",
          });
        }
        // §5 start_diagnosis : l'affectation d'un mécanicien lance le diagnostic.
        if (input.membershipId && order.status === "CHECKED_IN") {
          await applyTransition(tx, {
            order,
            to: "DIAGNOSING",
            transition: "start_diagnosis",
            membershipId: ctx.membership.id,
            now,
          });
        }
        void org;
        return { ...updated, skillWarning };
      });
    }),

  setSubcontractStatus: requirePermission("repair_order:update")
    .input(setSubcontractStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.transaction(async (tx) => {
        const { line, order } = await loadLine(tx, ctx, input.id);
        if (isLockedStatus(order.status)) lockedError();
        if (line.type !== "SUBCONTRACT") badRequest("Cette ligne n'est pas une sous-traitance.");
        return tx.repairOrderLine.update({
          where: { id: line.id },
          data: { subcontractStatus: input.status, subcontractExpectedAt: input.expectedAt },
        });
      });
    }),
});
