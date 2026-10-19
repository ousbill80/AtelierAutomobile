// RG-M07-01 — unités et quantités. Les quantités de stock sont des entiers en unité de base :
// baseQty = displayQty × Product.quantityScale (1 par défaut, 10 pour le litre et le kg).
import { DomainError } from "../errors";

export const PRODUCT_UNITS = ["pièce", "litre", "kit", "jeu", "mètre", "kg"] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

/** Échelle par défaut d'une unité : 10 (précision 0,1) pour le litre et le kg, sinon 1. */
export function defaultQuantityScale(unit: string): number {
  return unit === "litre" || unit === "kg" ? 10 : 1;
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new DomainError("stock.invalid_scale", "L'échelle de quantité doit être un entier ≥ 1.", {
      scale,
    });
  }
}

/** 4,5 L (scale 10) → 45. Refuse une précision supérieure à l'échelle (4,55 L → erreur). */
export function toBaseQty(displayQty: number, scale = 1): number {
  assertScale(scale);
  if (!Number.isFinite(displayQty)) {
    throw new DomainError("stock.invalid_quantity", "Quantité invalide.", { displayQty });
  }
  const raw = displayQty * scale;
  const rounded = Math.round(raw);
  if (Math.abs(raw - rounded) > 1e-9) {
    const decimals = Math.round(Math.log10(scale));
    throw new DomainError(
      "stock.invalid_precision",
      decimals === 0
        ? `Quantité ${formatQty(raw, 1)} invalide : quantité entière attendue.`
        : `Quantité trop précise : ${decimals} décimale${decimals > 1 ? "s" : ""} maximum pour cette unité.`,
      { displayQty, scale },
    );
  }
  return rounded;
}

/** 45 (scale 10) → 4,5. */
export function fromBaseQty(baseQty: number, scale = 1): number {
  assertScale(scale);
  return baseQty / scale;
}

/** Affichage français d'une quantité de base : 45 (scale 10) → "4,5". */
export function formatQty(baseQty: number, scale = 1): string {
  const value = fromBaseQty(baseQty, scale);
  const decimals = Math.round(Math.log10(scale));
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
    useGrouping: false,
  });
}

/** Valeur d'une quantité de base au coût unitaire (par unité d'affichage), arrondie à l'entier. */
export function valueOf(baseQty: number, scale: number, unitCost: number): number {
  assertScale(scale);
  return divRoundHalfUp(BigInt(baseQty) * BigInt(unitCost), BigInt(scale));
}

/** Division entière arrondie au demi supérieur en valeur absolue (comme `roundHalfUp`). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): number {
  if (denominator === BigInt(0))
    throw new DomainError("stock.division_by_zero", "Division par zéro.");
  const negative = numerator < BigInt(0) !== denominator < BigInt(0);
  const n = numerator < BigInt(0) ? -numerator : numerator;
  const d = denominator < BigInt(0) ? -denominator : denominator;
  const q = (BigInt(2) * n + d) / (BigInt(2) * d);
  const result = Number(q);
  return negative && result !== 0 ? -result : result;
}
