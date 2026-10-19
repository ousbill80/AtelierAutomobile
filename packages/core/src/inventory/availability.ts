// RG-M07-03/04 — disponible, disponible prévisionnel et découpage d'une réservation.
import { DomainError } from "../errors";

/** available = onHand − reserved (par site). */
export function availableQty(level: { onHand: number; reserved: number }): number {
  return level.onHand - level.reserved;
}

export interface IncomingLine {
  quantity: number;
  receivedQty: number;
}

/** Σ (quantity − receivedQty) des lignes de commandes SENT / PARTIALLY_RECEIVED (≥ 0 par ligne). */
export function incomingQty(lines: IncomingLine[]): number {
  return lines.reduce((sum, l) => sum + Math.max(l.quantity - l.receivedQty, 0), 0);
}

/** Disponible prévisionnel = available + commandes en cours. */
export function projectedAvailable(
  level: { onHand: number; reserved: number },
  incoming: IncomingLine[] | number,
): number {
  const extra = typeof incoming === "number" ? incoming : incomingQty(incoming);
  return availableQty(level) + extra;
}

export interface ReservationPlan {
  /** Quantité réservée immédiatement (RESERVED, reserved += q). */
  reserved: number;
  /** Reste en attente de réception (BACKORDERED). */
  backordered: number;
}

/** RG-M07-04 : réserve la partie disponible, le reste passe en BACKORDERED. */
export function planReservation(available: number, quantity: number): ReservationPlan {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new DomainError("stock.invalid_quantity", "La quantité à réserver doit être positive.", {
      quantity,
    });
  }
  const reserved = Math.min(Math.max(available, 0), quantity);
  return { reserved, backordered: quantity - reserved };
}

export interface BackorderLike {
  id: string;
  quantity: number;
  createdAt: Date;
}

export interface BackorderAllocation {
  id: string;
  /** Quantité à passer RESERVED (≤ quantity ; si < quantity, la réservation est scindée). */
  quantity: number;
  partial: boolean;
}

/**
 * US-M07-08 : à la réception, les réservations BACKORDERED passent RESERVED dans l'ordre
 * d'arrivée (createdAt), dans la limite du disponible. La dernière servie peut l'être en partie.
 */
export function allocateBackorders(
  backorders: BackorderLike[],
  available: number,
): BackorderAllocation[] {
  const sorted = [...backorders].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  let remaining = Math.max(available, 0);
  const out: BackorderAllocation[] = [];
  for (const b of sorted) {
    if (remaining <= 0) break;
    const q = Math.min(b.quantity, remaining);
    out.push({ id: b.id, quantity: q, partial: q < b.quantity });
    remaining -= q;
  }
  return out;
}

/** RG-M07-04 : une réservation RESERVED de plus de 30 jours sur un OR non actif est signalée. */
export function isStaleReservation(
  reservation: { status: string; createdAt: Date },
  repairOrderActive: boolean,
  now: Date,
  days = 30,
): boolean {
  if (reservation.status !== "RESERVED" || repairOrderActive) return false;
  return now.getTime() - reservation.createdAt.getTime() > days * 86_400_000;
}

/** Seuil mini d'un site en unités de base : StockLevel.minStock ?? Product.minStock × échelle. */
export function minStockOfLevel(
  level: { minStock: number | null },
  product: { minStock: number; quantityScale: number },
): number {
  return level.minStock ?? product.minStock * product.quantityScale;
}
