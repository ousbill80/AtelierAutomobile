// RG-M07-07 — suggestion de réapprovisionnement, en unités de base.
export interface SuggestReorderInput {
  /** Disponible prévisionnel du site (unités de base). */
  projected: number;
  /** StockLevel.minStock ?? Product.minStock (unités de base). */
  minStock: number;
  /** StockLevel.maxStock (unités de base) ; défaut 2 × min. */
  maxStock?: number | null;
  /** Product.reorderQty (unités de base). */
  reorderQty?: number | null;
  /** Product.packSize (unités de base), défaut 1. */
  packSize?: number | null;
  /** Réservations BACKORDERED non couvertes par une commande : s'ajoutent toujours. */
  uncoveredBackorders?: number;
}

export interface ReorderSuggestion {
  quantity: number;
  reason: "below_min" | "backorders" | "below_min_and_backorders";
}

function roundUpToPack(quantity: number, pack: number): number {
  if (quantity <= 0) return 0;
  return Math.ceil(quantity / pack) * pack;
}

export function suggestReorder(input: SuggestReorderInput): ReorderSuggestion | null {
  const pack = input.packSize && input.packSize > 0 ? input.packSize : 1;
  const backorders = Math.max(input.uncoveredBackorders ?? 0, 0);
  const belowMin = input.minStock > 0 && input.projected < input.minStock;

  let base = 0;
  if (belowMin) {
    const max = input.maxStock ?? 2 * input.minStock;
    base = Math.max(input.reorderQty ?? 0, max - input.projected);
  }
  const quantity = roundUpToPack(base + backorders, pack);
  if (quantity <= 0) return null;
  return {
    quantity,
    reason: belowMin ? (backorders > 0 ? "below_min_and_backorders" : "below_min") : "backorders",
  };
}
