// RG-M07-05 — frais d'approche (transport, dédouanement) répartis au prorata de la valeur
// des lignes, arrondis par ligne, le reste d'arrondi sur la dernière ligne.
import { DomainError } from "../errors";
import { divRoundHalfUp } from "./units";

export function allocateLandedCosts(total: number, lineValues: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new DomainError(
      "stock.invalid_landed_costs",
      "Les frais d'approche doivent être un montant positif.",
      {
        total,
      },
    );
  }
  if (lineValues.length === 0) return [];
  const sum = lineValues.reduce((s, v) => s + Math.max(v, 0), 0);
  // Lignes sans valeur (coût 0) : répartition égale.
  const weights = sum > 0 ? lineValues.map((v) => Math.max(v, 0)) : lineValues.map(() => 1);
  const weightSum = sum > 0 ? sum : lineValues.length;
  const out = weights.map((w) => divRoundHalfUp(BigInt(total) * BigInt(w), BigInt(weightSum)));
  const allocated = out.slice(0, -1).reduce((s, v) => s + v, 0);
  out[out.length - 1] = total - allocated;
  return out;
}

/** Coût unitaire d'entrée frais inclus : unitCost + allocated / qtyAffichage, arrondi. */
export function landedUnitCost(
  unitCost: number,
  allocated: number,
  baseQty: number,
  scale = 1,
): number {
  if (baseQty <= 0) return unitCost;
  return unitCost + divRoundHalfUp(BigInt(allocated) * BigInt(scale), BigInt(baseQty));
}
