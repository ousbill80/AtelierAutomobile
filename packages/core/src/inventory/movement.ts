// RG-M07-05/06/17 — calcul pur de l'effet d'un mouvement de stock : contrôle du signe,
// du stock négatif, nouveau CMP et coût de valorisation du mouvement. L'écriture (verrou,
// StockMovement + StockLevel + Product dans une transaction) est faite par packages/db.
import { DomainError } from "../errors";
import { computeWeightedAverageCost } from "./cost";
import { formatQty } from "./units";

export const STOCK_MOVEMENT_TYPES = [
  "PURCHASE_RECEIPT",
  "ISSUE_TO_RO",
  "RETURN_FROM_RO",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNT_CORRECTION",
  "SUPPLIER_RETURN",
] as const;
export type StockMovementTypeLike = (typeof STOCK_MOVEMENT_TYPES)[number];

const POSITIVE_ONLY: ReadonlySet<StockMovementTypeLike> = new Set([
  "PURCHASE_RECEIPT",
  "RETURN_FROM_RO",
  "TRANSFER_IN",
]);
const NEGATIVE_ONLY: ReadonlySet<StockMovementTypeLike> = new Set([
  "ISSUE_TO_RO",
  "TRANSFER_OUT",
  "SUPPLIER_RETURN",
]);
/** Entrées dont le coût est fourni (et recalcule réellement le CMP). */
const COSTED_ENTRIES: ReadonlySet<StockMovementTypeLike> = new Set([
  "PURCHASE_RECEIPT",
  "RETURN_FROM_RO",
]);
/** Sorties comptées pour les pièces dormantes (RG-M07-11). */
export const OUTGOING_TYPES_FOR_DORMANCY: readonly StockMovementTypeLike[] = [
  "ISSUE_TO_RO",
  "TRANSFER_OUT",
  "SUPPLIER_RETURN",
];

export interface SiteStock {
  siteCode: string;
  onHand: number;
}

export interface PlanMovementInput {
  type: StockMovementTypeLike;
  /** Unités de base, signé (positif = entrée). */
  quantity: number;
  /** Coût unitaire (FCFA / unité d'affichage) : requis pour PURCHASE_RECEIPT et RETURN_FROM_RO ;
   *  facultatif pour SUPPLIER_RETURN (coût d'achat d'origine), sinon CMP. */
  unitCost?: number | null;
  /** onHand du site concerné avant le mouvement. */
  siteOnHand: number;
  /** Σ onHand tous sites avant le mouvement. */
  totalOnHand: number;
  averageCost: number;
  allowNegative: boolean;
  quantityScale?: number;
  /** Pour le message « Stock insuffisant : 2 disponibles à YOP, 5 à COC ». */
  siteStocks?: SiteStock[];
}

export interface PlannedMovement {
  quantity: number;
  unitCost: number;
  siteOnHandAfter: number;
  totalOnHandAfter: number;
  averageCostAfter: number;
  /** Dernier prix d'achat à enregistrer (PURCHASE_RECEIPT uniquement). */
  purchasePrice: number | null;
  /** Le site passe sous zéro avec ce mouvement (RG-M07-06, stock négatif autorisé). */
  becameNegative: boolean;
  /** Le site repasse à ≥ 0 (« À régulariser » soldé). */
  regularized: boolean;
}

export function insufficientStockMessage(siteStocks: SiteStock[], scale = 1): string {
  if (siteStocks.length === 0) return "Stock insuffisant.";
  const parts = siteStocks.map(
    (s) =>
      `${formatQty(Math.max(s.onHand, 0), scale)} disponible${s.onHand > scale ? "s" : ""} à ${s.siteCode}`,
  );
  return `Stock insuffisant : ${parts.join(", ")}`;
}

export function planMovement(input: PlanMovementInput): PlannedMovement {
  const { type, quantity, siteOnHand, totalOnHand, averageCost, allowNegative } = input;
  const scale = input.quantityScale ?? 1;

  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new DomainError(
      "stock.invalid_quantity",
      "La quantité du mouvement doit être non nulle.",
      {
        quantity,
      },
    );
  }
  if (POSITIVE_ONLY.has(type) && quantity < 0) {
    throw new DomainError("stock.invalid_sign", `Un mouvement ${type} doit être positif.`, {
      type,
    });
  }
  if (NEGATIVE_ONLY.has(type) && quantity > 0) {
    throw new DomainError("stock.invalid_sign", `Un mouvement ${type} doit être négatif.`, {
      type,
    });
  }

  const siteOnHandAfter = siteOnHand + quantity;
  if (quantity < 0 && siteOnHandAfter < 0 && !allowNegative) {
    throw new DomainError(
      "stock.insufficient",
      insufficientStockMessage(input.siteStocks ?? [], scale),
      {
        siteOnHand,
        quantity,
      },
    );
  }

  let averageCostAfter = averageCost;
  let unitCost = averageCost;
  let purchasePrice: number | null = null;

  if (quantity > 0) {
    if (COSTED_ENTRIES.has(type)) {
      if (input.unitCost == null) {
        throw new DomainError(
          "stock.cost_required",
          "Le coût unitaire de l'entrée est obligatoire.",
          {
            type,
          },
        );
      }
      unitCost = input.unitCost;
    }
    averageCostAfter = computeWeightedAverageCost({
      onHandQty: totalOnHand,
      averageCost,
      entryQty: quantity,
      entryUnitCost: unitCost,
    });
    if (type === "PURCHASE_RECEIPT") purchasePrice = unitCost;
  } else if (type === "SUPPLIER_RETURN" && input.unitCost != null) {
    // RG-M07-16 : au coût d'achat d'origine si connu, sans modifier le CMP.
    unitCost = input.unitCost;
  }

  return {
    quantity,
    unitCost,
    siteOnHandAfter,
    totalOnHandAfter: totalOnHand + quantity,
    averageCostAfter,
    purchasePrice,
    becameNegative: siteOnHand >= 0 && siteOnHandAfter < 0,
    regularized: siteOnHand < 0 && siteOnHandAfter >= 0,
  };
}
