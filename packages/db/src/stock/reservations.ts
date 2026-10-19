// RG-M07-04 / US-M07-03/04/05 — réservations pour un OR, sorties et retours.
// `consumeForRepairOrder` est le point d'entrée prévu pour M04 (étape 3.2) : il consomme
// d'abord les réservations de l'OR puis sort le reste directement.
import { allocateBackorders, availableQty, DomainError, planReservation } from "@atelieros/core";
import type { StockMovement, StockReservation } from "@prisma/client";
import { emitStockEvent, notifyMembers, type StockContext, type Tx } from "./context";
import { applyMovement, checkBelowMinimum, ensureLevel, lockProducts } from "./movements";

export interface ReserveInput {
  siteId: string;
  productId: string;
  /** Unités de base. */
  quantity: number;
  repairOrderId?: string | null;
  repairOrderLineId?: string | null;
  purchaseOrderId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

export interface ReserveResult {
  reservations: StockReservation[];
  reserved: number;
  backordered: number;
  /** Numéro de l'OR qui détient la dernière unité réservée (§11, réservations concurrentes). */
  lastReservedBy: string | null;
}

export async function reserveStock(
  tx: Tx,
  ctx: StockContext,
  input: ReserveInput,
  now: Date,
): Promise<ReserveResult> {
  await lockProducts(tx, [input.productId], now);
  const product = await tx.product.findFirstOrThrow({ where: { id: input.productId } });
  if (!product.isActive) {
    throw new DomainError("stock.product_archived", "Ce produit est archivé.");
  }
  const level = await ensureLevel(tx, ctx.organizationId, input.siteId, input.productId);
  const plan = planReservation(availableQty(level), input.quantity);

  const base = {
    organizationId: ctx.organizationId,
    siteId: input.siteId,
    productId: input.productId,
    repairOrderId: input.repairOrderId ?? null,
    repairOrderLineId: input.repairOrderLineId ?? null,
    note: input.note ?? null,
    createdById: input.createdById ?? null,
    createdAt: now,
  };
  const reservations: StockReservation[] = [];
  if (plan.reserved > 0) {
    reservations.push(
      await tx.stockReservation.create({
        data: { ...base, quantity: plan.reserved, status: "RESERVED" },
      }),
    );
    const updated = await tx.stockLevel.update({
      where: { id: level.id },
      data: { reserved: level.reserved + plan.reserved },
    });
    await checkBelowMinimum(tx, ctx, product, level, updated);
  }
  let lastReservedBy: string | null = null;
  if (plan.backordered > 0) {
    reservations.push(
      await tx.stockReservation.create({
        data: {
          ...base,
          quantity: plan.backordered,
          status: "BACKORDERED",
          purchaseOrderId: input.purchaseOrderId ?? null,
        },
      }),
    );
    const latest = await tx.stockReservation.findFirst({
      where: {
        siteId: input.siteId,
        productId: input.productId,
        status: "RESERVED",
        repairOrderId: { not: null },
        ...(input.repairOrderId ? { NOT: { repairOrderId: input.repairOrderId } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (latest?.repairOrderId) {
      const ro = await tx.repairOrder.findFirst({
        where: { id: latest.repairOrderId },
        select: { number: true },
      });
      lastReservedBy = ro?.number ?? null;
    }
  }
  return {
    reservations,
    reserved: plan.reserved,
    backordered: plan.backordered,
    lastReservedBy,
  };
}

/** RESERVED/BACKORDERED → RELEASED (reserved −= q si RESERVED). */
export async function releaseReservation(
  tx: Tx,
  ctx: StockContext,
  reservationId: string,
  now: Date,
): Promise<StockReservation> {
  const reservation = await tx.stockReservation.findFirstOrThrow({ where: { id: reservationId } });
  if (reservation.status !== "RESERVED" && reservation.status !== "BACKORDERED") {
    throw new DomainError(
      "stock.reservation_closed",
      "Cette réservation est déjà sortie ou libérée.",
    );
  }
  if (reservation.status === "RESERVED") {
    await lockProducts(tx, [reservation.productId], now);
    const level = await ensureLevel(
      tx,
      ctx.organizationId,
      reservation.siteId,
      reservation.productId,
    );
    await tx.stockLevel.update({
      where: { id: level.id },
      data: { reserved: Math.max(level.reserved - reservation.quantity, 0) },
    });
  }
  return tx.stockReservation.update({
    where: { id: reservation.id },
    data: { status: "RELEASED" },
  });
}

/** RG-M07-04 : OR `CANCELLED` (ou lignes refusées) → libère toutes ses réservations ouvertes. */
export async function releaseForRepairOrder(
  tx: Tx,
  ctx: StockContext,
  repairOrderId: string,
  now: Date,
  repairOrderLineId?: string,
): Promise<number> {
  const open = await tx.stockReservation.findMany({
    where: {
      repairOrderId,
      ...(repairOrderLineId ? { repairOrderLineId } : {}),
      status: { in: ["RESERVED", "BACKORDERED"] },
    },
  });
  for (const r of open) await releaseReservation(tx, ctx, r.id, now);
  return open.length;
}

export interface IssueInput {
  reservationId?: string | null;
  repairOrderId?: string | null;
  repairOrderLineId?: string | null;
  productId: string;
  siteId: string;
  /** Unités de base, > 0. */
  quantity: number;
  createdById?: string | null;
  reason?: string | null;
}

/**
 * US-M07-04 : sortie vers un OR (`ISSUE_TO_RO`, au CMP courant). Avec une réservation : elle
 * passe `ISSUED` (scindée si la sortie est partielle) et `reserved` diminue d'autant.
 */
export async function issueStock(
  tx: Tx,
  ctx: StockContext,
  input: IssueInput,
  now: Date,
): Promise<{ movement: StockMovement; reservation: StockReservation | null }> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError("stock.invalid_quantity", "La quantité à sortir doit être positive.");
  }
  await lockProducts(tx, [input.productId], now);
  let reservation: StockReservation | null = null;
  if (input.reservationId) {
    reservation = await tx.stockReservation.findFirstOrThrow({
      where: { id: input.reservationId },
    });
    if (reservation.status !== "RESERVED") {
      throw new DomainError(
        "stock.reservation_not_reserved",
        reservation.status === "BACKORDERED"
          ? "Pièce en attente de réception : rien à sortir pour l'instant."
          : "Cette réservation est déjà sortie ou libérée.",
      );
    }
    if (reservation.productId !== input.productId || reservation.siteId !== input.siteId) {
      throw new DomainError("stock.reservation_mismatch", "La réservation ne correspond pas.");
    }
    if (input.quantity > reservation.quantity) {
      throw new DomainError(
        "stock.issue_exceeds_reservation",
        "La quantité sortie dépasse la quantité réservée.",
      );
    }
  }

  const issuedQty = input.quantity;
  const { movement } = await applyMovement(
    tx,
    ctx,
    {
      siteId: input.siteId,
      productId: input.productId,
      type: "ISSUE_TO_RO",
      quantity: -issuedQty,
      repairOrderId: input.repairOrderId ?? reservation?.repairOrderId ?? null,
      repairOrderLineId: input.repairOrderLineId ?? reservation?.repairOrderLineId ?? null,
      reservationId: reservation?.id ?? null,
      reservedDelta: reservation ? -issuedQty : 0,
      createdById: input.createdById ?? null,
      reason: input.reason ?? null,
      alreadyLocked: true,
    },
    now,
  );

  if (reservation) {
    const remainder = reservation.quantity - issuedQty;
    if (remainder > 0) {
      // Sortie partielle : le reste demeure réservé dans une nouvelle réservation.
      await tx.stockReservation.create({
        data: {
          organizationId: ctx.organizationId,
          siteId: reservation.siteId,
          productId: reservation.productId,
          repairOrderId: reservation.repairOrderId,
          repairOrderLineId: reservation.repairOrderLineId,
          quantity: remainder,
          status: "RESERVED",
          note: reservation.note,
          createdById: reservation.createdById,
          createdAt: reservation.createdAt,
        },
      });
    }
    reservation = await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: "ISSUED", quantity: issuedQty },
    });
  }
  return { movement, reservation };
}

export interface ConsumeForRepairOrderInput {
  productId: string;
  /** Unités de base. */
  quantity: number;
  repairOrderId: string;
  repairOrderLineId?: string | null;
  /** Par défaut : le site de l'OR. */
  siteId?: string | null;
  createdById?: string | null;
}

/**
 * Sortie de stock pour un OR (interface M04, RG-M04-09) : consomme d'abord les réservations
 * `RESERVED` de l'OR pour ce produit (les plus anciennes d'abord), puis sort le reste sans
 * réservation. Renvoie les mouvements créés.
 */
export async function consumeForRepairOrder(
  tx: Tx,
  ctx: StockContext,
  input: ConsumeForRepairOrderInput,
  now: Date,
): Promise<StockMovement[]> {
  let siteId = input.siteId ?? null;
  if (!siteId) {
    const ro = await tx.repairOrder.findFirstOrThrow({
      where: { id: input.repairOrderId },
      select: { siteId: true },
    });
    siteId = ro.siteId;
  }
  const reservations = await tx.stockReservation.findMany({
    where: {
      repairOrderId: input.repairOrderId,
      productId: input.productId,
      siteId,
      status: "RESERVED",
      ...(input.repairOrderLineId ? { repairOrderLineId: input.repairOrderLineId } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  const movements: StockMovement[] = [];
  let remaining = input.quantity;
  for (const r of reservations) {
    if (remaining <= 0) break;
    const q = Math.min(r.quantity, remaining);
    const { movement } = await issueStock(
      tx,
      ctx,
      {
        reservationId: r.id,
        productId: input.productId,
        siteId,
        quantity: q,
        repairOrderId: input.repairOrderId,
        repairOrderLineId: input.repairOrderLineId ?? r.repairOrderLineId,
        createdById: input.createdById,
      },
      now,
    );
    movements.push(movement);
    remaining -= q;
  }
  if (remaining > 0) {
    const { movement } = await issueStock(
      tx,
      ctx,
      {
        productId: input.productId,
        siteId,
        quantity: remaining,
        repairOrderId: input.repairOrderId,
        repairOrderLineId: input.repairOrderLineId,
        createdById: input.createdById,
      },
      now,
    );
    movements.push(movement);
  }
  return movements;
}

export interface ReturnFromRepairOrderInput {
  repairOrderId: string;
  repairOrderLineId?: string | null;
  productId: string;
  siteId: string;
  /** Unités de base. */
  quantity: number;
  /** false : pièce montée puis démontée → ajustement de perte (RG-M07-12). */
  resellable: boolean;
  reason?: string | null;
  createdById?: string | null;
}

/** US-M07-05 : retour au stock (`RETURN_FROM_RO`) au coût de la sortie d'origine. */
export async function returnFromRepairOrder(
  tx: Tx,
  ctx: StockContext,
  input: ReturnFromRepairOrderInput,
  now: Date,
): Promise<StockMovement[]> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new DomainError("stock.invalid_quantity", "La quantité retournée doit être positive.");
  }
  await lockProducts(tx, [input.productId], now);
  const history = await tx.stockMovement.findMany({
    where: {
      repairOrderId: input.repairOrderId,
      productId: input.productId,
      type: { in: ["ISSUE_TO_RO", "RETURN_FROM_RO"] },
    },
    orderBy: { createdAt: "asc" },
  });
  const netIssued = -history.reduce((s, m) => s + m.quantity, 0);
  if (input.quantity > netIssued) {
    throw new DomainError(
      "stock.return_exceeds_issued",
      netIssued <= 0
        ? "Aucune pièce de ce produit n'a été sortie pour cet OR."
        : "La quantité retournée dépasse la quantité sortie pour cet OR.",
      { netIssued },
    );
  }
  const lastIssue = [...history].reverse().find((m) => m.type === "ISSUE_TO_RO");
  const movements: StockMovement[] = [];
  const back = await applyMovement(
    tx,
    ctx,
    {
      siteId: input.siteId,
      productId: input.productId,
      type: "RETURN_FROM_RO",
      quantity: input.quantity,
      unitCost: lastIssue?.unitCost ?? undefined,
      repairOrderId: input.repairOrderId,
      repairOrderLineId: input.repairOrderLineId ?? null,
      reason: input.reason ?? null,
      createdById: input.createdById ?? null,
      alreadyLocked: true,
    },
    now,
  );
  movements.push(back.movement);
  if (!input.resellable) {
    const loss = await applyMovement(
      tx,
      ctx,
      {
        siteId: input.siteId,
        productId: input.productId,
        type: "ADJUSTMENT",
        quantity: -input.quantity,
        reasonCode: "demonte",
        reason: input.reason ?? "Pièce démontée non revendable",
        repairOrderId: input.repairOrderId,
        createdById: input.createdById ?? null,
        alreadyLocked: true,
      },
      now,
    );
    movements.push(loss.movement);
  }
  return movements;
}

export interface BackorderPromotion {
  reservationId: string;
  repairOrderId: string | null;
  quantity: number;
}

/**
 * US-M07-08 : après une entrée, les réservations BACKORDERED du site passent RESERVED par
 * ordre d'arrivée dans la limite du disponible ; le conseiller de l'OR est notifié.
 * À appeler produit verrouillé.
 */
export async function promoteBackorders(
  tx: Tx,
  ctx: StockContext,
  siteId: string,
  productId: string,
  now: Date,
): Promise<BackorderPromotion[]> {
  const backorders = await tx.stockReservation.findMany({
    where: { siteId, productId, status: "BACKORDERED" },
  });
  if (backorders.length === 0) return [];
  const level = await ensureLevel(tx, ctx.organizationId, siteId, productId);
  const allocations = allocateBackorders(backorders, availableQty(level));
  const promoted: BackorderPromotion[] = [];
  let reservedTotal = 0;
  for (const a of allocations) {
    const b = backorders.find((x) => x.id === a.id)!;
    if (a.partial) {
      await tx.stockReservation.create({
        data: {
          organizationId: ctx.organizationId,
          siteId,
          productId,
          repairOrderId: b.repairOrderId,
          repairOrderLineId: b.repairOrderLineId,
          quantity: b.quantity - a.quantity,
          status: "BACKORDERED",
          purchaseOrderId: b.purchaseOrderId,
          note: b.note,
          createdById: b.createdById,
          createdAt: b.createdAt,
        },
      });
    }
    await tx.stockReservation.update({
      where: { id: b.id },
      data: { status: "RESERVED", quantity: a.quantity },
    });
    reservedTotal += a.quantity;
    promoted.push({ reservationId: b.id, repairOrderId: b.repairOrderId, quantity: a.quantity });
  }
  if (reservedTotal > 0) {
    await tx.stockLevel.update({
      where: { id: level.id },
      data: { reserved: level.reserved + reservedTotal },
    });
  }

  const roIds = [
    ...new Set(promoted.map((p) => p.repairOrderId).filter((id): id is string => !!id)),
  ];
  if (roIds.length > 0) {
    const orders = await tx.repairOrder.findMany({
      where: { id: { in: roIds } },
      select: { id: true, number: true, advisorId: true, vehicle: { select: { plate: true } } },
    });
    for (const ro of orders) {
      await emitStockEvent(tx, ctx.organizationId, "stock.received", {
        repairOrderId: ro.id,
        productId,
        siteId,
      });
      if (ro.advisorId) {
        await notifyMembers(
          tx,
          ctx.organizationId,
          { membershipIds: [ro.advisorId] },
          {
            type: "stock.parts_arrived",
            title: `Pièces arrivées pour ${ro.vehicle.plate}`,
            body: `Les pièces en attente de l'OR ${ro.number} sont réservées.`,
            severity: "info",
            dedupeKey: `stock.parts_arrived:${ro.id}:${productId}:${now.toISOString()}`,
          },
        );
      }
    }
  }
  return promoted;
}
