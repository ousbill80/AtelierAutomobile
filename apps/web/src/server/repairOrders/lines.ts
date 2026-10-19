// M04 RG-M04-06/07/08 — construction d'une ligne d'OR (prix, TVA, remise, payeur) et
// enchaînements automatiques liés aux lignes (start_work, complete_work, accord tracé).
import { TRPCError } from "@trpc/server";
import {
  addDays,
  businessDate,
  canTransition,
  isWorkableLine,
  laborLinePricing,
  lineAmounts,
  type RepairOrderTransition,
} from "@atelieros/core";
import type { Customer, Prisma, RepairOrder, ScopedTenantClient } from "@atelieros/db";
import type { LineInput } from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "../context";
import {
  applyTransition,
  badRequest,
  membersWithRoles,
  notify,
  syncOrderStock,
  transitionFacts,
  type OrgRoContext,
} from "./helpers";

type Tx = ScopedTenantClient;
type OrgCtx = Ctx & {
  user: CtxUser;
  session: CtxSession;
  membership: CtxMembership;
  organizationId: string;
};

/** Données de création d'une ligne, hors approbation et ordre d'affichage. */
export async function buildLineData(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgRoContext,
  order: Pick<RepairOrder, "id" | "organizationId" | "warrantyDecision">,
  customer: Pick<Customer, "discountRate">,
  line: LineInput,
  priceReason?: string,
): Promise<Prisma.RepairOrderLineUncheckedCreateInput> {
  let quantity = line.quantity;
  let unitPrice = line.unitPrice;
  let vatRate = line.vatRate ?? (org.vatEnabled ? org.vatRate : 0);
  let laborOperationId: string | undefined;
  let productId: string | undefined;

  if (line.type === "LABOR" && line.laborOperationId) {
    const op = await tx.laborOperation.findFirst({ where: { id: line.laborOperationId } });
    if (!op) badRequest("Opération de main-d'œuvre introuvable.");
    laborOperationId = op.id;
    const pricing = laborLinePricing(op, org.laborRates);
    if (unitPrice === undefined) unitPrice = pricing.unitPrice;
    if (op.fixedPrice != null) quantity = 1;
  }
  if (line.type === "PART" && line.productId) {
    const product = await tx.product.findFirst({ where: { id: line.productId } });
    if (!product) badRequest("Pièce introuvable.");
    productId = product.id;
    if (unitPrice === undefined) unitPrice = product.salePrice;
    if (line.vatRate === undefined) vatRate = org.vatEnabled ? product.vatRate : 0;
    // RG-M04-06 : prix sous le minimum → permission + motif (audit).
    if (
      !line.isCustomerSupplied &&
      product.minSalePrice != null &&
      unitPrice < product.minSalePrice
    ) {
      if (!ctx.permissions.has("invoice:price_below_min")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Prix inférieur au minimum autorisé pour « ${product.name} ». Demandez au gérant.`,
        });
      }
      if (!priceReason?.trim()) badRequest("Indiquez le motif du prix sous le minimum.");
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "repair_order.price_below_min",
        entity: "RepairOrder",
        entityId: order.id,
        after: { productId: product.id, unitPrice, minSalePrice: product.minSalePrice },
        reason: priceReason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }
  }
  if (line.type === "PART" && line.isCustomerSupplied) unitPrice = 0;
  if (unitPrice === undefined) badRequest("Indiquez le prix unitaire.");

  const payer = line.payer ?? (order.warrantyDecision === "COVERED" ? "WARRANTY" : "CUSTOMER");
  return {
    organizationId: order.organizationId,
    repairOrderId: order.id,
    type: line.type,
    productId,
    laborOperationId,
    description: line.supplierName
      ? `${line.description} — ${line.supplierName}`
      : line.description,
    quantity,
    unitPrice,
    discountRate: line.discountRate ?? customer.discountRate ?? 0,
    vatRate,
    assignedToId: line.assignedToId,
    payer,
    isCustomerSupplied: Boolean(line.isCustomerSupplied),
    supplierId: line.supplierId,
    costPrice: line.costPrice,
    subcontractStatus: line.type === "SUBCONTRACT" ? "TO_SEND" : undefined,
    warrantyMonths: line.warrantyMonths,
    warrantyKm: line.warrantyKm,
  };
}

/** Cumul TTC des lignes pré-autorisées après la réception (RG-M04-08). */
export async function preAuthorizedTotal(
  tx: Tx,
  repairOrderId: string,
  vatEnabled: boolean,
): Promise<number> {
  const lines = await tx.repairOrderLine.findMany({
    where: { repairOrderId, approvalSource: "PRE_AUTHORIZED", status: { not: "CANCELLED" } },
  });
  return lines.reduce((s, l) => s + lineAmounts(l, vatEnabled).total, 0);
}

async function trySystemTransition(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgRoContext,
  repairOrderId: string,
  transition: RepairOrderTransition,
  now: Date,
): Promise<RepairOrder | null> {
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: repairOrderId } });
  const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  const facts = await transitionFacts(tx, order);
  const result = canTransition(order, lines, transition, {
    permissions: ctx.permissions,
    system: true,
    qcRequired: org.settings.qcRequired,
    ...facts,
  });
  if (!result.ok) return null;
  return applyTransition(tx, {
    order,
    to: result.to,
    transition,
    membershipId: null,
    now,
  });
}

/**
 * Enchaînements automatiques après une modification de ligne (§5) :
 * - première ligne démarrée sur un OR APPROVED → `start_work` ;
 * - toutes les lignes approuvées terminées sur un OR IN_PROGRESS → `complete_work` ;
 * - plus aucune ligne en attente sur un OR AWAITING_APPROVAL → `approve` ou `decline_all`.
 */
export async function afterLineChange(
  tx: Tx,
  ctx: OrgCtx,
  org: OrgRoContext,
  repairOrderId: string,
  now: Date,
): Promise<void> {
  const order = await tx.repairOrder.findFirstOrThrow({ where: { id: repairOrderId } });
  // M07 : réservations ajustées aux lignes (ajout, quantité, refus, annulation).
  await syncOrderStock(tx, order, now, ctx.membership.id);
  const lines = await tx.repairOrderLine.findMany({ where: { repairOrderId } });
  const live = lines.filter((l) => l.status !== "CANCELLED");
  if (order.status === "APPROVED" && live.some((l) => l.status !== "PENDING")) {
    await trySystemTransition(tx, ctx, org, order.id, "start_work", now);
  }
  const current = await tx.repairOrder.findFirstOrThrow({ where: { id: repairOrderId } });
  if (current.status === "IN_PROGRESS") {
    const workable = live.filter((l) => isWorkableLine(l));
    if (workable.length > 0 && workable.every((l) => l.status === "DONE")) {
      const done = await trySystemTransition(tx, ctx, org, order.id, "complete_work", now);
      if (done?.status === "QUALITY_CHECK") {
        await notify(tx, ctx.organizationId, await membersWithRoles(tx, ["MANAGER"]), {
          type: "repair_order.qc_needed",
          title: `Contrôle qualité à faire — ${order.number}`,
          link: `/ordres/${order.id}/controle-qualite`,
        });
      }
    }
  }
  if (current.status === "AWAITING_APPROVAL" && !live.some((l) => l.approval === "PENDING")) {
    const approved = await trySystemTransition(tx, ctx, org, order.id, "approve", now);
    if (!approved) await trySystemTransition(tx, ctx, org, order.id, "decline_all", now);
  }
}

/** A8 / RG-M04-17 : ligne refusée → travaux conseillés relancés à J+30 (M10). */
export async function recordDeclinedRecommendation(
  tx: Tx,
  org: OrgRoContext,
  order: Pick<RepairOrder, "id" | "organizationId" | "vehicleId" | "customerId">,
  line: { description: string; inspectionItemId: string | null; quoteLineId: string | null },
  total: number,
  now: Date,
): Promise<void> {
  await tx.vehicleRecommendation.create({
    data: {
      organizationId: order.organizationId,
      vehicleId: order.vehicleId,
      customerId: order.customerId,
      repairOrderId: order.id,
      inspectionItemId: line.inspectionItemId,
      quoteLineId: line.quoteLineId,
      label: line.description,
      severity: "WATCH",
      estimatedAmount: total,
      remindAt: addDays(businessDate(now, org.timeZone), 30),
    },
  });
}
