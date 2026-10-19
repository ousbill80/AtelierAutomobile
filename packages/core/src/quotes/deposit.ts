// RG-M05-14 — acompte à l'acceptation : seuil et taux, arrondi à la centaine supérieure,
// au moins le coût d'achat des pièces commandées spécialement.
import type { DepositRule } from "./settings";

export interface DepositInput {
  acceptedTotal: number;
  rule: DepositRule | null;
  /** Σ coût d'achat des pièces acceptées non stockées (`isStocked = false`). */
  specialPartsCost?: number;
}

/** Arrondi à la centaine supérieure (0 reste 0). */
export function roundUpToHundred(value: number): number {
  return Math.ceil(value / 100) * 100;
}

/** Montant d'acompte suggéré, 0 si aucune règle ne s'applique. */
export function depositAmount(input: DepositInput): number {
  let amount = 0;
  if (input.rule && input.acceptedTotal >= input.rule.thresholdTtc && input.acceptedTotal > 0) {
    amount = roundUpToHundred((input.acceptedTotal * input.rule.rate) / 100);
  }
  const special = Math.max(0, input.specialPartsCost ?? 0);
  if (special > 0) amount = Math.max(amount, roundUpToHundred(special));
  return Math.min(amount, input.acceptedTotal);
}
