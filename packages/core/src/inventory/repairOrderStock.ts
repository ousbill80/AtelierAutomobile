// RG-M04-09 / RG-M07-04 — réservations d'un OR : décision pure, par ligne, de ce qu'il faut
// réserver ou libérer pour que les réservations ouvertes couvrent exactement le reste à sortir.

/** Statuts d'OR où les pièces approuvées doivent être réservées. */
export const RESERVING_REPAIR_ORDER_STATUSES: readonly string[] = [
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
];

/** Statuts où l'on ne touche plus aux réservations (véhicule rendu, facturé). */
export const FROZEN_REPAIR_ORDER_STATUSES: readonly string[] = ["DELIVERED", "INVOICED"];

export interface RepairOrderLineStockInput {
  type: string;
  productId: string | null;
  isCustomerSupplied: boolean;
  status: string;
  approval: string;
  /** Produit tenu en stock (false = commandé à la demande, mais réservable quand reçu). */
  productActive?: boolean;
}

/** Ligne concernée par le stock : pièce / consommable du catalogue, non fournie par le client. */
export function isStockLine(line: RepairOrderLineStockInput): boolean {
  return (
    (line.type === "PART" || line.type === "CONSUMABLE") &&
    !!line.productId &&
    !line.isCustomerSupplied
  );
}

/** Ligne à réserver : pièce de stock active, approuvée (ou sans accord requis), non annulée. */
export function isReservableLine(line: RepairOrderLineStockInput, orderStatus: string): boolean {
  return (
    RESERVING_REPAIR_ORDER_STATUSES.includes(orderStatus) &&
    isStockLine(line) &&
    line.status !== "CANCELLED" &&
    (line.approval === "APPROVED" || line.approval === "NOT_REQUIRED") &&
    line.productActive !== false
  );
}

export type LineStockAction =
  | { action: "none" }
  | { action: "reserve"; quantity: number }
  | { action: "resync"; quantity: number };

/**
 * `target` : quantité de la ligne, `issued` : déjà sortie (net des retours), `open` : réservations
 * RESERVED + BACKORDERED ouvertes (unités de base). Ligne non réservable → tout libérer.
 * Sinon les réservations ouvertes doivent valoir max(target − issued, 0) : on complète, ou on
 * libère puis on réserve à nouveau le bon reste (quantité réduite).
 */
export function planLineStock(input: {
  reservable: boolean;
  target: number;
  issued: number;
  open: number;
}): LineStockAction {
  const remaining = input.reservable ? Math.max(input.target - input.issued, 0) : 0;
  if (input.open === remaining) return { action: "none" };
  if (input.open < remaining) return { action: "reserve", quantity: remaining - input.open };
  return { action: "resync", quantity: remaining };
}

/** Quantité de ligne d'OR (unités d'affichage, flottante) → unités de base entières. */
export function lineBaseQty(quantity: number, quantityScale: number): number {
  return Math.max(Math.round(quantity * quantityScale), 0);
}

export type LineStockState = "none" | "reserved" | "partial" | "missing" | "issued";

/** Badge de la ligne (« Pièce manquante » si une partie attend une réception). */
export function lineStockState(input: {
  target: number;
  issued: number;
  reserved: number;
  backordered: number;
}): LineStockState {
  if (input.target <= 0) return "none";
  if (input.issued >= input.target) return "issued";
  if (input.backordered > 0) return input.reserved + input.issued > 0 ? "partial" : "missing";
  if (input.reserved + input.issued >= input.target) return "reserved";
  return "none";
}
