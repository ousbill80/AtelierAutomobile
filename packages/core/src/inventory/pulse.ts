// Pilotage magasin : ruptures, seuils, valeur et commandes ouvertes d'un garage.
import { availableQty, minStockOfLevel } from "./availability";
import { isPurchaseOrderLate } from "./purchase";
import { valueOf } from "./units";

/** Niveau déjà ramené au site consulté. `minStock` est en unités de base. */
export interface PulseLevel {
  productId: string;
  onHand: number;
  reserved: number;
  minStock: number;
  quantityScale: number;
  averageCost: number;
  isStocked: boolean;
}

export interface PulsePurchase {
  status: string;
  expectedAt: Date | null;
}

export interface GaragePulse {
  /** Références actives (une fois chacune, même sans ligne de stock). */
  products: number;
  /** Pièces stockées dont le disponible d'au moins un site est sous le mini. */
  belowMin: number;
  /** Pièces stockées dont le disponible total est à zéro, sans stock négatif. */
  outOfStock: number;
  /** Pièces avec au moins un site en stock négatif. */
  negative: number;
  /** Valeur du stock positif au CMP (RG-M07-09 : les négatifs sont exclus). */
  stockValue: number;
  drafts: number;
  /** Bons envoyés ou reçus en partie, pas encore soldés. */
  toReceive: number;
  late: number;
}

export interface GaragePulseInput {
  /**
   * Un niveau par produit et par site visible. Un produit actif sans ligne de stock
   * doit être passé avec `onHand` 0 : il compte comme une rupture si son mini est > 0.
   */
  levels: PulseLevel[];
  purchases: PulsePurchase[];
  now: Date;
}

/** Résumé du magasin à partir des niveaux et des bons ouverts. */
export function summarizeGaragePulse(input: GaragePulseInput): GaragePulse {
  const byProduct = new Map<string, PulseLevel[]>();
  for (const level of input.levels) {
    const group = byProduct.get(level.productId) ?? [];
    group.push(level);
    byProduct.set(level.productId, group);
  }

  let belowMin = 0;
  let outOfStock = 0;
  let negative = 0;
  let stockValue = 0;
  for (const group of byProduct.values()) {
    const stocked = group.some((level) => level.isStocked);
    const hasNegative = group.some((level) => level.onHand < 0);
    const available = group.reduce((sum, level) => sum + availableQty(level), 0);
    if (stocked && group.some((level) => availableQty(level) < level.minStock)) belowMin += 1;
    if (stocked && hasNegative) negative += 1;
    else if (stocked && available <= 0) outOfStock += 1;
    for (const level of group) {
      if (level.onHand > 0) {
        stockValue += valueOf(level.onHand, level.quantityScale, level.averageCost);
      }
    }
  }

  let drafts = 0;
  let toReceive = 0;
  let late = 0;
  for (const purchase of input.purchases) {
    if (purchase.status === "DRAFT") drafts += 1;
    if (purchase.status === "SENT" || purchase.status === "PARTIALLY_RECEIVED") toReceive += 1;
    if (isPurchaseOrderLate(purchase, input.now)) late += 1;
  }

  return {
    products: byProduct.size,
    belowMin,
    outOfStock,
    negative,
    stockValue,
    drafts,
    toReceive,
    late,
  };
}

/** Niveau synthétique d'un produit qui n'a pas encore de ligne sur le site consulté. */
export function emptyPulseLevel(product: {
  id: string;
  isStocked: boolean;
  minStock: number;
  quantityScale: number;
  averageCost: number;
}): PulseLevel {
  return {
    productId: product.id,
    onHand: 0,
    reserved: 0,
    minStock: minStockOfLevel({ minStock: null }, product),
    quantityScale: product.quantityScale,
    averageCost: product.averageCost,
    isStocked: product.isStocked,
  };
}
