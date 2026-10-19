// RG-M04-09 / RG-M07-04 — branchement stock ↔ ordres de réparation. `syncRepairOrderStock`
// est idempotente : appelée après chaque transition d'OR et chaque changement de ligne, elle
// ajuste les réservations pour couvrir exactement le reste à sortir de chaque ligne de pièce
// approuvée (OR approuvé → réserver, ligne refusée / annulée / OR annulé → libérer).
import {
  FROZEN_REPAIR_ORDER_STATUSES,
  isReservableLine,
  isStockLine,
  lineBaseQty,
  lineStockState,
  planLineStock,
  type LineStockState,
} from "@atelieros/core";
import type { StockMovement } from "@prisma/client";
import type { StockContext, Tx } from "./context";
import { issueStock, releaseReservation, reserveStock } from "./reservations";

export interface RepairOrderLineStock {
  lineId: string;
  productId: string;
  quantityScale: number;
  /** Unités de base. */
  target: number;
  issued: number;
  reserved: number;
  backordered: number;
  state: LineStockState;
}

async function loadState(tx: Tx, repairOrderId: string) {
  const [lines, reservations, movements] = await Promise.all([
    tx.repairOrderLine.findMany({
      where: { repairOrderId },
      include: { product: { select: { id: true, quantityScale: true, isActive: true } } },
    }),
    tx.stockReservation.findMany({
      where: { repairOrderId, status: { in: ["RESERVED", "BACKORDERED"] } },
      orderBy: { createdAt: "asc" },
    }),
    tx.stockMovement.findMany({
      where: { repairOrderId, type: { in: ["ISSUE_TO_RO", "RETURN_FROM_RO"] } },
      select: { repairOrderLineId: true, quantity: true },
    }),
  ]);
  const issuedByLine = new Map<string, number>();
  for (const m of movements) {
    if (!m.repairOrderLineId) continue;
    issuedByLine.set(
      m.repairOrderLineId,
      (issuedByLine.get(m.repairOrderLineId) ?? 0) - m.quantity,
    );
  }
  return { lines, reservations, issuedByLine };
}

/** État stock de chaque ligne de pièce d'un OR (réservé, en attente, sorti) pour l'affichage. */
export async function repairOrderLineStock(
  tx: Tx,
  repairOrderId: string,
): Promise<RepairOrderLineStock[]> {
  const { lines, reservations, issuedByLine } = await loadState(tx, repairOrderId);
  return lines
    .filter((l) => isStockLine(l) && l.product)
    .map((l) => {
      const own = reservations.filter((r) => r.repairOrderLineId === l.id);
      const target =
        l.status === "CANCELLED" ? 0 : lineBaseQty(l.quantity, l.product!.quantityScale);
      const issued = issuedByLine.get(l.id) ?? 0;
      const reserved = own
        .filter((r) => r.status === "RESERVED")
        .reduce((s, r) => s + r.quantity, 0);
      const backordered = own
        .filter((r) => r.status === "BACKORDERED")
        .reduce((s, r) => s + r.quantity, 0);
      return {
        lineId: l.id,
        productId: l.productId!,
        quantityScale: l.product!.quantityScale,
        target,
        issued,
        reserved,
        backordered,
        state: lineStockState({ target, issued, reserved, backordered }),
      };
    });
}

export interface SyncRepairOrderStockResult {
  reserved: number;
  backordered: number;
  released: number;
}

export async function syncRepairOrderStock(
  tx: Tx,
  ctx: StockContext,
  repairOrderId: string,
  now: Date,
  createdById: string | null = null,
): Promise<SyncRepairOrderStockResult> {
  const result: SyncRepairOrderStockResult = { reserved: 0, backordered: 0, released: 0 };
  const order = await tx.repairOrder.findFirstOrThrow({
    where: { id: repairOrderId },
    select: { id: true, siteId: true, status: true },
  });
  if (FROZEN_REPAIR_ORDER_STATUSES.includes(order.status)) return result;
  const { lines, reservations, issuedByLine } = await loadState(tx, repairOrderId);

  async function releaseAll(ids: string[]) {
    for (const id of ids) {
      await releaseReservation(tx, ctx, id, now);
      result.released++;
    }
  }

  // Réservations orphelines (ligne supprimée ou devenue hors stock) : libérées.
  const stockLineIds = new Set(lines.filter((l) => isStockLine(l)).map((l) => l.id));
  await releaseAll(
    reservations
      .filter((r) => !r.repairOrderLineId || !stockLineIds.has(r.repairOrderLineId))
      .map((r) => r.id),
  );

  for (const line of lines) {
    if (!isStockLine(line) || !line.product) continue;
    const own = reservations.filter((r) => r.repairOrderLineId === line.id);
    const open = own.reduce((s, r) => s + r.quantity, 0);
    const plan = planLineStock({
      reservable: isReservableLine({ ...line, productActive: line.product.isActive }, order.status),
      target: lineBaseQty(line.quantity, line.product.quantityScale),
      issued: issuedByLine.get(line.id) ?? 0,
      open,
    });
    if (plan.action === "none") continue;
    if (plan.action === "resync") await releaseAll(own.map((r) => r.id));
    if (plan.quantity > 0) {
      const r = await reserveStock(
        tx,
        ctx,
        {
          siteId: order.siteId,
          productId: line.product.id,
          quantity: plan.quantity,
          repairOrderId: order.id,
          repairOrderLineId: line.id,
          createdById,
        },
        now,
      );
      result.reserved += r.reserved;
      result.backordered += r.backordered;
    }
  }
  return result;
}

/**
 * RG-M04-09 : à la validation d'une ligne (DONE), les pièces réservées pour elle sont sorties
 * (ISSUE_TO_RO au CMP). Ce qui reste en attente de réception reste dans la file du magasin.
 */
export async function issueReservedForLine(
  tx: Tx,
  ctx: StockContext,
  repairOrderLineId: string,
  now: Date,
  createdById: string | null = null,
): Promise<StockMovement[]> {
  const reservations = await tx.stockReservation.findMany({
    where: { repairOrderLineId, status: "RESERVED" },
    orderBy: { createdAt: "asc" },
  });
  const movements: StockMovement[] = [];
  for (const r of reservations) {
    const { movement } = await issueStock(
      tx,
      ctx,
      {
        reservationId: r.id,
        productId: r.productId,
        siteId: r.siteId,
        quantity: r.quantity,
        repairOrderId: r.repairOrderId,
        repairOrderLineId,
        createdById,
      },
      now,
    );
    movements.push(movement);
  }
  return movements;
}
