/**
 * Arrondi au plus proche entier, demi vers le haut en valeur absolue
 * (RG-M08-05) : -0.5 → -1, 0.5 → 1 (pas d'arrondi bancaire).
 */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(value));
}
