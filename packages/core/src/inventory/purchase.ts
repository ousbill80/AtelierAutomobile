// RG-M07-08 et §5 — bons de commande : total, statuts, écarts de prix.
import { DomainError } from "../errors";
import { valueOf } from "./units";

export type PurchaseOrderStatusLike =
  "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export interface PurchaseLineLike {
  quantity: number;
  receivedQty: number;
  unitCost: number;
  quantityScale?: number;
}

/** Total = Σ quantity × unitCost (unités d'affichage, arrondi par ligne). */
export function computePurchaseOrderTotal(lines: PurchaseLineLike[]): number {
  return lines.reduce((s, l) => s + valueOf(l.quantity, l.quantityScale ?? 1, l.unitCost), 0);
}

/** Statut après une réception : RECEIVED si toutes les lignes sont reçues, sinon PARTIALLY_RECEIVED. */
export function statusAfterReceipt(
  lines: Pick<PurchaseLineLike, "quantity" | "receivedQty">[],
): "PARTIALLY_RECEIVED" | "RECEIVED" {
  return lines.every((l) => l.receivedQty >= l.quantity) ? "RECEIVED" : "PARTIALLY_RECEIVED";
}

const TRANSITIONS: Record<PurchaseOrderStatusLike, PurchaseOrderStatusLike[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
  PARTIALLY_RECEIVED: ["PARTIALLY_RECEIVED", "RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

const STATUS_LABELS: Record<PurchaseOrderStatusLike, string> = {
  DRAFT: "brouillon",
  SENT: "envoyé",
  PARTIALLY_RECEIVED: "reçu partiellement",
  RECEIVED: "reçu",
  CANCELLED: "annulé",
};

export function assertPurchaseOrderTransition(
  from: PurchaseOrderStatusLike,
  to: PurchaseOrderStatusLike,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    const message =
      from === "PARTIALLY_RECEIVED" && to === "CANCELLED"
        ? "Une commande reçue partiellement ne peut pas être annulée : soldez le reliquat."
        : `Impossible de passer un bon de commande ${STATUS_LABELS[from]} à « ${STATUS_LABELS[to]} ».`;
    throw new DomainError("purchase.invalid_transition", message, { from, to });
  }
}

/** RG-M07-08 : modifiable en DRAFT ; en SENT, ajout de lignes seulement, jamais sous receivedQty. */
export function assertPurchaseLineEdit(
  status: PurchaseOrderStatusLike,
  change: { kind: "add" | "update" | "remove"; quantity?: number; receivedQty?: number },
): void {
  if (status === "DRAFT") return;
  if (status === "SENT" || status === "PARTIALLY_RECEIVED") {
    if (change.kind === "add") return;
    if (
      change.kind === "update" &&
      change.quantity != null &&
      change.quantity >= (change.receivedQty ?? 0)
    ) {
      return;
    }
    throw new DomainError(
      "purchase.locked",
      change.kind === "update"
        ? "La quantité ne peut pas être inférieure à la quantité déjà reçue."
        : "Commande envoyée : on peut seulement ajouter des lignes.",
    );
  }
  throw new DomainError("purchase.locked", "Ce bon de commande n'est plus modifiable.");
}

export interface PriceVariance {
  expected: number;
  actual: number;
  diff: number;
  /** % arrondi à 1 décimale. */
  pct: number;
}

export function priceVariance(expected: number, actual: number): PriceVariance | null {
  if (expected === actual) return null;
  const diff = actual - expected;
  const pct = expected > 0 ? Math.round((diff * 1000) / expected) / 10 : 100;
  return { expected, actual, diff, pct };
}

/** §11 : prix aberrant (×10 ou ÷10 du dernier prix) → confirmation avant recalcul du CMP. */
export function isAberrantPrice(actual: number, reference: number | null | undefined): boolean {
  if (!reference || reference <= 0 || actual <= 0) return false;
  return actual >= reference * 10 || actual * 10 <= reference;
}

/** Une commande est en retard si SENT/PARTIALLY_RECEIVED et expectedAt dépassée. */
export function isPurchaseOrderLate(
  po: { status: string; expectedAt: Date | null },
  now: Date,
): boolean {
  return (
    (po.status === "SENT" || po.status === "PARTIALLY_RECEIVED") &&
    po.expectedAt != null &&
    po.expectedAt.getTime() < now.getTime()
  );
}
