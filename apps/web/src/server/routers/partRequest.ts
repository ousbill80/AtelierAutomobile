// M06 §5/§8 — demandes de pièces tablette → magasin (US-M06-07). Le magasinier les traite
// (M07 : `stock:issue`) ; à la livraison, la pièce est ajoutée à l'OR comme ligne PART, avec
// accord client selon M04 (plafond pré-autorisé, sinon en attente).
import { TRPCError } from "@trpc/server";
import {
  assertPartRequestTransition,
  decideLineApproval,
  DomainError,
  lineAmounts,
  type PartRequestStatusValue,
} from "@atelieros/core";
import { db, type ScopedTenantClient } from "@atelieros/db";
import {
  partRequestCreateInputSchema,
  partRequestListInputSchema,
  partRequestUpdateStatusInputSchema,
} from "@atelieros/validators";
import { emitDomainEvent } from "../events/emit";
import {
  assertRoModule,
  badRequest,
  loadOrgRoContext,
  notFound,
  notify,
  recomputeTotals,
  roNow,
  syncOrderStock,
  type OrgRoContext,
} from "../repairOrders/helpers";
import { preAuthorizedTotal } from "../repairOrders/lines";
import { orgProcedure, requirePermission, requireSite, router } from "../trpc";
import { createPartRequest, rejectionMessage } from "../workshop/tasks";

type Tx = ScopedTenantClient;

const STATUS_LABEL: Record<PartRequestStatusValue, string> = {
  REQUESTED: "demandée",
  PREPARING: "en préparation",
  ORDERED: "commandée",
  DELIVERED: "livrée",
  REJECTED: "refusée",
  CANCELLED: "annulée",
};

/** US-M06-07 : pièce livrée → ligne PART de l'OR (si pas déjà prévue). */
async function addDeliveredPart(
  tx: Tx,
  org: OrgRoContext,
  request: { repairOrderId: string; productId: string; quantity: number },
  membershipId: string,
  now: Date,
) {
  const existing = await tx.repairOrderLine.findFirst({
    where: {
      repairOrderId: request.repairOrderId,
      productId: request.productId,
      status: { not: "CANCELLED" },
    },
  });
  if (existing) return null;
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: request.repairOrderId } });
  const product = await tx.product.findFirstOrThrow({ where: { id: request.productId } });
  const vatRate = org.vatEnabled ? product.vatRate : 0;
  const total = lineAmounts(
    {
      type: "PART",
      quantity: request.quantity,
      unitPrice: product.salePrice,
      discountRate: 0,
      vatRate,
      status: "PENDING",
      approval: "PENDING",
      payer: "CUSTOMER",
      isCustomerSupplied: false,
    },
    org.vatEnabled,
  ).total;
  const checkIn = (order.checkIn ?? {}) as { authorizationCeiling?: number };
  const decision = decideLineApproval({
    payer: "CUSTOMER",
    phase: "AFTER_CHECK_IN",
    authorizationCeiling: checkIn.authorizationCeiling ?? 0,
    preAuthorizedTotal: await preAuthorizedTotal(tx, order.id, org.vatEnabled),
    lineTotal: total,
  });
  const sortOrder = await tx.repairOrderLine.count({ where: { repairOrderId: order.id } });
  const line = await tx.repairOrderLine.create({
    data: {
      organizationId: order.organizationId,
      repairOrderId: order.id,
      type: "PART",
      productId: product.id,
      description: product.name,
      quantity: request.quantity,
      unitPrice: product.salePrice,
      vatRate,
      sortOrder,
      ...decision,
    },
  });
  await emitDomainEvent(tx as never, order.organizationId, "repair_order.line_added", {
    repairOrderId: order.id,
    lineId: line.id,
    approval: line.approval,
  });
  await recomputeTotals(tx, order.id, org.vatEnabled);
  await syncOrderStock(tx, order, now, membershipId);
  return line;
}

export const partRequestRouter = router({
  create: requirePermission("partrequest:create")
    .input(partRequestCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      try {
        return await tenantDb.transaction((tx) =>
          createPartRequest(
            tx,
            {
              organizationId: ctx.organizationId,
              actorId: ctx.membership.id,
              allowedSiteIds: ctx.allowedSiteIds,
              clientOpId: input.clientOpId,
            },
            {
              repairOrderId: input.repairOrderId,
              lineId: input.repairOrderLineId,
              productId: input.productId,
              freeText: input.freeText,
              quantity: input.quantity,
              urgency: input.urgency,
            },
          ),
        );
      } catch (error) {
        const message = rejectionMessage(error);
        if (message) badRequest(message, error);
        throw error;
      }
    }),

  /** File magasin (stock:issue) ou mes demandes (partrequest:create). */
  list: orgProcedure.input(partRequestListInputSchema).query(async ({ ctx, input }) => {
    const storekeeper = ctx.permissions.has("stock:issue");
    if (!storekeeper && !ctx.permissions.has("partrequest:create")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Permission manquante : stock:issue" });
    }
    if (input.siteId) requireSite(ctx, input.siteId);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.partRequest.findMany({
      where: {
        ...(input.siteId
          ? { siteId: input.siteId }
          : ctx.allowedSiteIds === "ALL"
            ? {}
            : { siteId: { in: ctx.allowedSiteIds } }),
        ...(input.status ? { status: input.status } : {}),
        ...(input.repairOrderId ? { repairOrderId: input.repairOrderId } : {}),
        ...(storekeeper ? {} : { requestedById: ctx.membership.id }),
      },
      include: {
        product: { select: { name: true, sku: true } },
        repairOrder: { select: { id: true, number: true, vehicle: { select: { plate: true } } } },
        requestedBy: { select: { user: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      urgency: r.urgency,
      label: r.product?.name ?? r.freeText ?? "",
      sku: r.product?.sku ?? null,
      quantity: r.quantity,
      repairOrder: {
        id: r.repairOrder.id,
        number: r.repairOrder.number,
        plate: r.repairOrder.vehicle.plate,
      },
      requestedBy: r.requestedBy.user.name,
      rejectReason: r.rejectReason,
      createdAt: r.createdAt,
      canCancel: r.requestedById === ctx.membership.id && r.status === "REQUESTED",
    }));
  }),

  updateStatus: orgProcedure
    .input(partRequestUpdateStatusInputSchema)
    .mutation(async ({ ctx, input }) => {
      const org = await loadOrgRoContext(ctx.organizationId);
      assertRoModule(org);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = roNow();
      return tenantDb.transaction(async (tx) => {
        const request = await tx.partRequest.findFirst({ where: { id: input.id } });
        if (!request) notFound("Demande de pièce introuvable.");
        requireSite(ctx, request.siteId);
        const byRequester = request.requestedById === ctx.membership.id;
        if (input.status !== "CANCELLED" && !ctx.permissions.has("stock:issue")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Permission manquante : stock:issue" });
        }
        try {
          assertPartRequestTransition(request.status, input.status, {
            reason: input.reason,
            byRequester,
          });
        } catch (error) {
          if (error instanceof DomainError) badRequest(error.message, error);
          throw error;
        }
        const updated = await tx.partRequest.update({
          where: { id: request.id },
          data: {
            status: input.status,
            handledById: input.status === "CANCELLED" ? request.handledById : ctx.membership.id,
            rejectReason: input.status === "REJECTED" ? input.reason!.trim() : request.rejectReason,
            purchaseOrderId: input.purchaseOrderId ?? request.purchaseOrderId,
          },
        });
        let addedLineId: string | null = null;
        if (input.status === "DELIVERED" && request.productId) {
          const line = await addDeliveredPart(
            tx,
            org,
            {
              repairOrderId: request.repairOrderId,
              productId: request.productId,
              quantity: request.quantity,
            },
            ctx.membership.id,
            now,
          );
          addedLineId = line?.id ?? null;
        }
        const order = await tx.repairOrder.findFirstOrThrow({
          where: { id: request.repairOrderId },
        });
        if (!byRequester) {
          await notify(tx, ctx.organizationId, [request.requestedById], {
            type: "part_request.status_changed",
            title: `Pièce ${STATUS_LABEL[input.status]} — ${order.number}`,
            body: input.status === "REJECTED" ? input.reason : undefined,
            link: "/tablette/taches",
          });
        }
        await emitDomainEvent(tx as never, ctx.organizationId, "part_request.status_changed", {
          partRequestId: request.id,
          repairOrderId: request.repairOrderId,
          from: request.status,
          to: input.status,
          addedLineId,
        });
        return { ...updated, addedLineId };
      });
    }),
});
