// RG-M07-17 — point d'écriture unique du stock : `applyMovement` crée le `StockMovement` et
// met à jour `StockLevel.onHand` (et le CMP du `Product`) dans la transaction de l'appelant.
// Verrou : un UPDATE sur la ligne `Product` (équivalent d'un `SELECT … FOR UPDATE`) est posé
// en premier ; tous les écrivains du stock d'un produit passant par lui, les mouvements et
// réservations concurrents d'un même produit sont sérialisés (CMP et disponible cohérents).
import {
  applyMovementDuringCount,
  incomingQty,
  minStockOfLevel,
  OUTGOING_TYPES_FOR_DORMANCY,
  planMovement,
  projectedAvailable,
  type PlannedMovement,
  type StockMovementTypeLike,
} from "@atelieros/core";
import type { Product, StockLevel, StockMovement } from "@prisma/client";
import { emitStockEvent, notifyMembers, type StockContext, type Tx } from "./context";

/** Verrouille les produits (ordre d'id croissant, pour éviter les interblocages). */
export async function lockProducts(tx: Tx, productIds: string[], now: Date): Promise<void> {
  for (const id of [...new Set(productIds)].sort()) {
    await tx.product.update({ where: { id }, data: { updatedAt: now } });
  }
}

/** Ligne `StockLevel` du site, créée à 0 si absente (à appeler produit verrouillé). */
export async function ensureLevel(
  tx: Tx,
  organizationId: string,
  siteId: string,
  productId: string,
): Promise<StockLevel> {
  const existing = await tx.stockLevel.findFirst({ where: { siteId, productId } });
  if (existing) return existing;
  return tx.stockLevel.create({ data: { organizationId, siteId, productId } });
}

export interface ApplyMovementInput {
  siteId: string;
  productId: string;
  type: StockMovementTypeLike;
  /** Unités de base, signé. */
  quantity: number;
  unitCost?: number | null;
  reason?: string | null;
  reasonCode?: string | null;
  repairOrderId?: string | null;
  repairOrderLineId?: string | null;
  purchaseOrderId?: string | null;
  reservationId?: string | null;
  transferId?: string | null;
  countId?: string | null;
  createdById?: string | null;
  /** Variation de `reserved` sur le même site (sortie d'une réservation : −q). */
  reservedDelta?: number;
  /** Surcharge du paramètre `settings.stock.allowNegative`. */
  allowNegative?: boolean;
  /** Le produit est déjà verrouillé par l'appelant (réception multi-lignes). */
  alreadyLocked?: boolean;
}

export interface ApplyMovementResult {
  movement: StockMovement;
  level: StockLevel;
  product: Product;
  plan: PlannedMovement;
}

/** Quantités attendues (BC SENT / PARTIALLY_RECEIVED) d'un produit sur un site (RG-M07-03). */
export async function incomingFor(tx: Tx, siteId: string, productId: string): Promise<number> {
  const lines = await tx.purchaseOrderLine.findMany({
    where: {
      productId,
      purchaseOrder: { siteId, status: { in: ["SENT", "PARTIALLY_RECEIVED"] } },
    },
    select: { quantity: true, receivedQty: true },
  });
  return incomingQty(lines);
}

/**
 * `stock.below_minimum` (§9) : émis quand le prévisionnel passe sous le mini, une fois par
 * produit et site jusqu'à remontée (détection du franchissement).
 */
export async function checkBelowMinimum(
  tx: Tx,
  ctx: StockContext,
  product: Product,
  before: StockLevel,
  after: StockLevel,
): Promise<boolean> {
  if (!product.isStocked || !product.isActive) return false;
  const min = minStockOfLevel(after, product);
  if (min <= 0) return false;
  const incoming = await incomingFor(tx, after.siteId, product.id);
  const projectedBefore = projectedAvailable(before, incoming);
  const projectedAfter = projectedAvailable(after, incoming);
  if (projectedBefore >= min && projectedAfter < min) {
    await emitStockEvent(tx, ctx.organizationId, "stock.below_minimum", {
      productId: product.id,
      siteId: after.siteId,
      projected: projectedAfter,
      minStock: min,
    });
    return true;
  }
  return false;
}

export async function applyMovement(
  tx: Tx,
  ctx: StockContext,
  input: ApplyMovementInput,
  now: Date,
): Promise<ApplyMovementResult> {
  const { organizationId } = ctx;
  if (!input.alreadyLocked) await lockProducts(tx, [input.productId], now);

  const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
  const level = await ensureLevel(tx, organizationId, input.siteId, input.productId);
  const levels = await tx.stockLevel.findMany({
    where: { productId: input.productId },
    include: { site: { select: { code: true } } },
    orderBy: { site: { code: "asc" } },
  });
  const totalOnHand = levels.reduce((s, l) => s + l.onHand, 0);
  const current = levels.find((l) => l.siteId === input.siteId);
  const siteStocks = [
    ...(current ? [current] : []),
    ...levels.filter((l) => l.siteId !== input.siteId),
  ].map((l) => ({ siteCode: l.site.code, onHand: l.onHand }));

  const plan = planMovement({
    type: input.type,
    quantity: input.quantity,
    unitCost: input.unitCost,
    siteOnHand: level.onHand,
    totalOnHand,
    averageCost: product.averageCost,
    allowNegative: input.allowNegative ?? ctx.settings.allowNegative,
    quantityScale: product.quantityScale,
    siteStocks,
  });

  const movement = await tx.stockMovement.create({
    data: {
      organizationId,
      siteId: input.siteId,
      productId: input.productId,
      type: input.type,
      quantity: plan.quantity,
      unitCost: plan.unitCost,
      costAfter: plan.averageCostAfter,
      reason: input.reason ?? null,
      reasonCode: input.reasonCode ?? null,
      repairOrderId: input.repairOrderId ?? null,
      repairOrderLineId: input.repairOrderLineId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      reservationId: input.reservationId ?? null,
      transferId: input.transferId ?? null,
      countId: input.countId ?? null,
      createdById: input.createdById ?? null,
      createdAt: now,
    },
  });

  const reserved = Math.max(level.reserved + (input.reservedDelta ?? 0), 0);
  const updatedLevel = await tx.stockLevel.update({
    where: { id: level.id },
    data: { onHand: plan.siteOnHandAfter, reserved },
  });

  const isOutgoing = OUTGOING_TYPES_FOR_DORMANCY.includes(input.type);
  const updatedProduct = await tx.product.update({
    where: { id: product.id },
    data: {
      averageCost: plan.averageCostAfter,
      ...(plan.purchasePrice != null ? { purchasePrice: plan.purchasePrice } : {}),
      ...(isOutgoing ? { lastIssuedAt: now } : {}),
    },
  });

  // RG-M07-10 : un mouvement pendant un inventaire du site met à jour le théorique de la ligne
  // non encore comptée, ou la signale « mouvement après comptage ».
  if (!input.countId) {
    const countLines = await tx.stockCountLine.findMany({
      where: {
        productId: input.productId,
        stockCount: { siteId: input.siteId, status: { in: ["IN_PROGRESS", "SUBMITTED"] } },
      },
    });
    for (const line of countLines) {
      const effect = applyMovementDuringCount(line, plan.quantity);
      await tx.stockCountLine.update({
        where: { id: line.id },
        data: {
          expectedQty: effect.expectedQty,
          ...(effect.movedAfterCount ? { movedAfterCount: true } : {}),
        },
      });
    }
  }

  // RG-M07-06 : passage en négatif → alerte gérant.
  if (plan.becameNegative) {
    await emitStockEvent(tx, organizationId, "stock.negative", {
      productId: product.id,
      siteId: input.siteId,
      onHand: plan.siteOnHandAfter,
      movementId: movement.id,
    });
    await notifyMembers(
      tx,
      organizationId,
      { roles: ["OWNER", "MANAGER"] },
      {
        type: "stock.negative",
        title: `Stock négatif : ${product.name}`,
        body: `Le stock de ${product.sku} est passé sous zéro. Régularisez la situation.`,
        link: `/stock/${product.id}`,
        severity: "warning",
        dedupeKey: `stock.negative:${product.id}:${input.siteId}:${now.toISOString().slice(0, 10)}`,
      },
    );
  }

  await checkBelowMinimum(tx, ctx, updatedProduct, level, updatedLevel);

  return { movement, level: updatedLevel, product: updatedProduct, plan };
}
