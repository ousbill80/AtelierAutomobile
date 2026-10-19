// RG-M05-14 — acompte à l'acceptation.
import type { DepositRule } from "./settings";

/** Arrondi à la centaine supérieure. */
export function ceilToHundred(amount: number): number {
  return Math.ceil(amount / 100) * 100;
}

export interface DepositInput {
  acceptedTotal: number;
  rule: DepositRule | null;
  /** Coût d'achat des pièces commandées spécialement (`isStocked = false`). */
  specialOrderCost?: number;
}

/**
 * Montant d'acompte suggéré : `round(accepté × taux / 100)` arrondi à la centaine supérieure
 * au-delà du seuil ; au moins le coût des pièces spéciales, même sous le seuil ; jamais plus
 * que le total accepté. 0 = pas d'acompte.
 */
export function depositAmount(input: DepositInput): number {
  if (input.acceptedTotal <= 0) return 0;
  let amount = 0;
  if (input.rule && input.rule.rate > 0 && input.acceptedTotal >= input.rule.thresholdTtc) {
    amount = ceilToHundred((input.acceptedTotal * input.rule.rate) / 100);
  }
  const special = input.specialOrderCost ?? 0;
  if (special > 0) amount = Math.max(amount, ceilToHundred(special));
  return Math.min(amount, input.acceptedTotal);
}
