// RG-M07-13 / US-M07-12 — contrôle du prix de vente d'une ligne PART/CONSUMABLE.
import { roundHalfUp } from "../money/round";

export interface CheckSalePriceInput {
  unitPrice: number;
  discountRate?: number;
  minSalePrice?: number | null;
  averageCost?: number | null;
}

export interface CheckSalePriceResult {
  netUnitPrice: number;
  belowMin: boolean;
  belowCost: boolean;
  /** true si aucune alerte. */
  ok: boolean;
  /** Prix sous le minimum : dérogation `invoice:price_below_min` + motif. */
  requiresOverride: boolean;
  /** Vente à perte : motif obligatoire même pour le gérant. */
  reasonRequired: boolean;
  minSalePrice: number | null;
  averageCost: number | null;
  /** Marge sur le prix net, en % entier (null si prix nul). */
  marginRate: number | null;
}

/** net HT unitaire = unitPrice × (100 − discountRate) / 100. */
export function netUnitPrice(unitPrice: number, discountRate = 0): number {
  return roundHalfUp((unitPrice * (100 - discountRate)) / 100);
}

export function checkSalePrice(input: CheckSalePriceInput): CheckSalePriceResult {
  const net = netUnitPrice(input.unitPrice, input.discountRate ?? 0);
  const min = input.minSalePrice ?? null;
  const cost = input.averageCost && input.averageCost > 0 ? input.averageCost : null;
  const belowMin = min != null && net < min;
  const belowCost = cost != null && net < cost;
  return {
    netUnitPrice: net,
    belowMin,
    belowCost,
    ok: !belowMin && !belowCost,
    requiresOverride: belowMin,
    reasonRequired: belowMin || belowCost,
    minSalePrice: min,
    averageCost: cost,
    marginRate: computeMarginRate(net, cost ?? 0),
  };
}

/** marge = (salePrice − averageCost) / salePrice, en % arrondi. */
export function computeMarginRate(salePrice: number, averageCost: number): number | null {
  if (salePrice <= 0) return null;
  return roundHalfUp(((salePrice - averageCost) * 100) / salePrice);
}
