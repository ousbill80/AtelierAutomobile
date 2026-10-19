// RG-M07-05/07/08 / US-M07-06/08 — bons de commande : réception (partielle, frais d'approche,
// écarts de prix, backorders), solde, annulation, suggestions de réapprovisionnement.
import {
  allocateLandedCosts,
  assertPurchaseOrderTransition,
  computePurchaseOrderTotal,
  DomainError,
  incomingQty,
  isAberrantPrice,
  landedUnitCost,
  priceVariance,
  projectedAvailable,
  statusAfterReceipt,
  suggestReorder,
  valueOf,
  type PriceVariance,
  type PurchaseOrderStatusLike,
} from "@atelieros/core";
import type { PurchaseOrder, StockMovement } from "@prisma/client";
import { emitStockEvent, type StockContext, type Tx } from "./context";
import { applyMovement, lockProducts } from "./movements";
import { promoteBackorders, type BackorderPromotion } from "./reservations";

export interface ReceiveLineInput {
  lineId: string;
  /** Unités de base, > 0. */
  quantity: number;
  /** Coût unitaire réel HT (FCFA / unité d'affichage). */
  unitCost: number;
}

export interface ReceiveExtraLineInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  lines: ReceiveLineInput[];
  /** Réception « hors commande » (§11) : lignes ajoutées au BC avec audit par l'appelant. */
  extraLines?: ReceiveExtraLineInput[];
  /** Frais d'approche (transport, dédouanement) en FCFA, répartis au prorata. */
  landedCosts?: number;
  /** Confirmation d'un prix aberrant (×10 du dernier prix). */
  confirmAberrantPrices?: boolean;
  createdById?: string | null;
}

export interface ReceivePriceVariance extends PriceVariance {
  lineId: string;
  productId: string;
  productName: string;
}

export interface ReceivePurchaseOrderResult {
  purchaseOrder: PurchaseOrder;
  movements: StockMovement[];
  priceVariances: ReceivePriceVariance[];
  promoted: BackorderPromotion[];
}

export async function receivePurchaseOrder(
  tx: Tx,
  ctx: StockContext,
  input: ReceivePurchaseOrderInput,
  now: Date,
): Promise<ReceivePurchaseOrderResult> {
  const po = await tx.purchaseOrder.findFirstOrThrow({
    where: { id: input.purchaseOrderId },
    include: { lines: { include: { product: true } } },
  });
  if (po.status !== "SENT" && po.status !== "PARTIALLY_RECEIVED") {
    throw new DomainError(
      "purchase.not_receivable",
      po.status === "DRAFT"
        ? "Envoyez le bon de commande avant de le réceptionner."
        : "Ce bon de commande n'attend plus de réception.",
    );
  }

  // Lignes hors commande : ajoutées au BC avant la réception (RG-M07-08, ajout en SENT).
  const extraLines = [];
  for (const extra of input.extraLines ?? []) {
    if (extra.quantity <= 0) continue;
    const product = await tx.product.findFirstOrThrow({ where: { id: extra.productId } });
    const line = await tx.purchaseOrderLine.create({
      data: {
        organizationId: ctx.organizationId,
        purchaseOrderId: po.id,
        productId: product.id,
        quantity: extra.quantity,
        unitCost: extra.unitCost,
      },
      include: { product: true },
    });
    po.lines.push(line);
    extraLines.push({ lineId: line.id, quantity: extra.quantity, unitCost: extra.unitCost });
  }

  const receipts = [...input.lines, ...extraLines].filter((l) => l.quantity > 0);
  if (receipts.length === 0) {
    throw new DomainError("purchase.nothing_received", "Indiquez au moins une quantité reçue.");
  }
  const byLine = receipts.map((r) => {
    const line = po.lines.find((l) => l.id === r.lineId);
    if (!line) {
      throw new DomainError("purchase.unknown_line", "Ligne de commande introuvable.");
    }
    if (!Number.isInteger(r.quantity) || r.quantity <= 0) {
      throw new DomainError("purchase.invalid_quantity", "Quantité reçue invalide.");
    }
    if (line.receivedQty + r.quantity > line.quantity) {
      throw new DomainError(
        "purchase.over_receipt",
        `Quantité reçue supérieure au reliquat pour ${line.product.name} : ajoutez une ligne hors commande.`,
        { lineId: line.id },
      );
    }
    if (!Number.isInteger(r.unitCost) || r.unitCost < 0) {
      throw new DomainError(
        "purchase.invalid_cost",
        "Le coût unitaire doit être un entier positif.",
      );
    }
    return { receipt: r, line };
  });

  // §11 : prix aberrant → confirmation explicite avant recalcul du CMP.
  if (!input.confirmAberrantPrices) {
    const aberrant = byLine.find(({ receipt, line }) =>
      isAberrantPrice(receipt.unitCost, line.product.purchasePrice || line.unitCost),
    );
    if (aberrant) {
      const ref = aberrant.line.product.purchasePrice || aberrant.line.unitCost;
      throw new DomainError(
        "purchase.aberrant_price",
        `Prix ${aberrant.receipt.unitCost.toLocaleString("fr-FR")} au lieu de ${ref.toLocaleString("fr-FR")} habituel pour ${aberrant.line.product.name} : confirmer ?`,
        { lineId: aberrant.line.id, unitCost: aberrant.receipt.unitCost, reference: ref },
      );
    }
  }

  const allocations = allocateLandedCosts(
    input.landedCosts ?? 0,
    byLine.map(({ receipt, line }) =>
      valueOf(receipt.quantity, line.product.quantityScale, receipt.unitCost),
    ),
  );

  await lockProducts(
    tx,
    byLine.map(({ line }) => line.productId),
    now,
  );

  const movements: StockMovement[] = [];
  const priceVariances: ReceivePriceVariance[] = [];
  for (const [i, { receipt, line }] of byLine.entries()) {
    const entryCost = landedUnitCost(
      receipt.unitCost,
      allocations[i] ?? 0,
      receipt.quantity,
      line.product.quantityScale,
    );
    const { movement } = await applyMovement(
      tx,
      ctx,
      {
        siteId: po.siteId,
        productId: line.productId,
        type: "PURCHASE_RECEIPT",
        quantity: receipt.quantity,
        unitCost: entryCost,
        purchaseOrderId: po.id,
        createdById: input.createdById ?? null,
        alreadyLocked: true,
      },
      now,
    );
    movements.push(movement);
    line.receivedQty += receipt.quantity;
    await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: { receivedQty: line.receivedQty, receivedCost: receipt.unitCost },
    });
    const variance = priceVariance(line.unitCost, receipt.unitCost);
    if (variance) {
      priceVariances.push({
        ...variance,
        lineId: line.id,
        productId: line.productId,
        productName: line.product.name,
      });
    }
  }

  const status = statusAfterReceipt(po.lines);
  const updated = await tx.purchaseOrder.update({
    where: { id: po.id },
    data: {
      status,
      receivedAt: status === "RECEIVED" ? now : null,
      total: computePurchaseOrderTotal(
        po.lines.map((l) => ({ ...l, quantityScale: l.product.quantityScale })),
      ),
    },
  });

  const promoted: BackorderPromotion[] = [];
  for (const productId of [...new Set(byLine.map(({ line }) => line.productId))]) {
    promoted.push(...(await promoteBackorders(tx, ctx, po.siteId, productId, now)));
  }
  await emitStockEvent(tx, ctx.organizationId, "stock.received", {
    purchaseOrderId: po.id,
    siteId: po.siteId,
    productIds: byLine.map(({ line }) => line.productId),
  });

  return { purchaseOrder: updated, movements, priceVariances, promoted };
}

/** §5 : solder le reliquat (SENT / PARTIALLY_RECEIVED → RECEIVED), motif obligatoire. */
export async function closePurchaseOrder(
  tx: Tx,
  purchaseOrderId: string,
  now: Date,
): Promise<PurchaseOrder> {
  const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: purchaseOrderId } });
  assertPurchaseOrderTransition(po.status as PurchaseOrderStatusLike, "RECEIVED");
  // Les réservations attendues sur ce BC ne le sont plus.
  await tx.stockReservation.updateMany({
    where: { purchaseOrderId, status: "BACKORDERED" },
    data: { purchaseOrderId: null },
  });
  return tx.purchaseOrder.update({
    where: { id: po.id },
    data: { status: "RECEIVED", receivedAt: now },
  });
}

/** §5 : DRAFT / SENT → CANCELLED (gérant, motif) ; libère les liens réservations. */
export async function cancelPurchaseOrder(tx: Tx, purchaseOrderId: string): Promise<PurchaseOrder> {
  const po = await tx.purchaseOrder.findFirstOrThrow({ where: { id: purchaseOrderId } });
  assertPurchaseOrderTransition(po.status as PurchaseOrderStatusLike, "CANCELLED");
  await tx.stockReservation.updateMany({
    where: { purchaseOrderId },
    data: { purchaseOrderId: null },
  });
  return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED" } });
}

export interface SuggestionLine {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  quantityScale: number;
  /** Unités de base. */
  suggestedQty: number;
  projected: number;
  minStock: number;
  backordered: number;
  unitCost: number;
  reason: "below_min" | "backorders" | "below_min_and_backorders";
}

export interface SupplierSuggestion {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestionLine[];
}

/** US-M07-06 / RG-M07-07 : suggestions du site, groupées par fournisseur par défaut. */
export async function computeReorderSuggestions(
  tx: Tx,
  siteId: string,
): Promise<SupplierSuggestion[]> {
  const products = await tx.product.findMany({
    where: { isActive: true, isStocked: true },
    include: {
      defaultSupplier: { select: { id: true, name: true } },
      stockLevels: { where: { siteId } },
    },
    orderBy: { sku: "asc" },
  });
  const openLines = await tx.purchaseOrderLine.findMany({
    where: { purchaseOrder: { siteId, status: { in: ["SENT", "PARTIALLY_RECEIVED", "DRAFT"] } } },
    select: {
      productId: true,
      quantity: true,
      receivedQty: true,
      purchaseOrder: { select: { status: true } },
    },
  });
  const backorders = await tx.stockReservation.groupBy({
    by: ["productId"],
    where: { siteId, status: "BACKORDERED", purchaseOrderId: null },
    _sum: { quantity: true },
  });

  const groups = new Map<string, SupplierSuggestion>();
  for (const p of products) {
    const level = p.stockLevels[0] ?? { onHand: 0, reserved: 0, minStock: null, maxStock: null };
    const lines = openLines.filter((l) => l.productId === p.id);
    // Les brouillons couvrent déjà une partie du besoin : comptés comme attendus.
    const projected = projectedAvailable(level, incomingQty(lines));
    const backordered = backorders.find((b) => b.productId === p.id)?._sum.quantity ?? 0;
    const minStock = level.minStock ?? p.minStock * p.quantityScale;
    const suggestion = suggestReorder({
      projected,
      minStock,
      maxStock: level.maxStock,
      reorderQty: p.reorderQty != null ? p.reorderQty * p.quantityScale : null,
      packSize: p.packSize * p.quantityScale,
      uncoveredBackorders: backordered,
    });
    if (!suggestion) continue;
    const key = p.defaultSupplier?.id ?? "";
    const group = groups.get(key) ?? {
      supplierId: p.defaultSupplier?.id ?? null,
      supplierName: p.defaultSupplier?.name ?? null,
      lines: [],
    };
    group.lines.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      quantityScale: p.quantityScale,
      suggestedQty: suggestion.quantity,
      projected,
      minStock,
      backordered,
      unitCost: p.purchasePrice || p.averageCost,
      reason: suggestion.reason,
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    (a.supplierName ?? "￿").localeCompare(b.supplierName ?? "￿"),
  );
}
