// RG-M07-05 — coût moyen pondéré (CMP), global par organisation, recalculé à chaque entrée
// positive. Les quantités sont en unités de base : l'échelle se simplifie dans la formule
// (Q⁺ × C + q × c) / (Q⁺ + q), donc le calcul reste en entiers exacts (BigInt).
import { DomainError } from "../errors";
import { divRoundHalfUp } from "./units";

export interface WeightedAverageCostInput {
  /** Σ onHand tous sites avant l'entrée (unités de base), peut être négatif. */
  onHandQty: number;
  /** CMP avant l'entrée (FCFA par unité d'affichage). */
  averageCost: number;
  /** Quantité entrée (unités de base, > 0). */
  entryQty: number;
  /** Coût unitaire d'entrée HT (FCFA par unité d'affichage). */
  entryUnitCost: number;
}

/** CMP' = round_half_up((Q⁺ × C + q × c) / (Q⁺ + q)), Q⁺ = max(Q, 0). */
export function computeWeightedAverageCost(input: WeightedAverageCostInput): number {
  const { onHandQty, averageCost, entryQty, entryUnitCost } = input;
  if (!Number.isInteger(entryQty) || entryQty <= 0) {
    throw new DomainError(
      "stock.invalid_entry_quantity",
      "Le CMP ne se recalcule que sur une entrée de quantité positive.",
      { entryQty },
    );
  }
  if (!Number.isInteger(entryUnitCost) || entryUnitCost < 0) {
    throw new DomainError("stock.invalid_cost", "Le coût unitaire doit être un entier positif.", {
      entryUnitCost,
    });
  }
  const qPlus = BigInt(Math.max(onHandQty, 0));
  const q = BigInt(entryQty);
  const numerator = qPlus * BigInt(averageCost) + q * BigInt(entryUnitCost);
  return divRoundHalfUp(numerator, qPlus + q);
}
