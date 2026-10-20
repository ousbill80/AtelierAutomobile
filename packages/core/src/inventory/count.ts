// RG-M07-10 — inventaire : écarts en quantité et en valeur, mouvements pendant le comptage.
import { valueOf } from "./units";

export interface CountLineLike {
  expectedQty: number;
  countedQty: number | null;
  unitCost: number;
}

export interface CountVariance {
  variance: number;
  varianceValue: number;
}

/** Écart = countedQty − expectedQty ; valeur = écart × CMP (unités d'affichage). */
export function computeCountVariance(line: CountLineLike, scale = 1): CountVariance {
  if (line.countedQty == null) return { variance: 0, varianceValue: 0 };
  const variance = line.countedQty - line.expectedQty;
  return { variance, varianceValue: valueOf(variance, scale, line.unitCost) };
}

export interface CountMovementEffect {
  expectedQty: number;
  /** Mouvement survenu après le comptage de la ligne : signalé, théorique inchangé. */
  movedAfterCount: boolean;
}

/** Un mouvement pendant l'inventaire s'ajoute au théorique si la ligne n'est pas encore comptée. */
export function applyMovementDuringCount(
  line: { expectedQty: number; countedQty: number | null },
  movementQty: number,
): CountMovementEffect {
  if (line.countedQty == null) {
    return { expectedQty: line.expectedQty + movementQty, movedAfterCount: false };
  }
  return { expectedQty: line.expectedQty, movedAfterCount: true };
}

export interface CountSummary {
  linesTotal: number;
  linesCounted: number;
  linesWithVariance: number;
  /** Σ valeurs d'écart (signé). */
  netValue: number;
  /** Σ |valeurs d'écart| : comparée au seuil de validation OWNER. */
  absoluteValue: number;
}

export function summarizeCount(
  lines: (CountLineLike & { quantityScale?: number })[],
): CountSummary {
  let linesCounted = 0;
  let linesWithVariance = 0;
  let netValue = 0;
  let absoluteValue = 0;
  for (const line of lines) {
    if (line.countedQty == null) continue;
    linesCounted++;
    const v = computeCountVariance(line, line.quantityScale ?? 1);
    if (v.variance !== 0) linesWithVariance++;
    netValue += v.varianceValue;
    absoluteValue += Math.abs(v.varianceValue);
  }
  return { linesTotal: lines.length, linesCounted, linesWithVariance, netValue, absoluteValue };
}

/** Écart valorisé au-dessus du seuil (défaut 50 000 FCFA) → validation OWNER obligatoire. */
export function countRequiresOwnerValidation(absoluteValue: number, threshold: number): boolean {
  return absoluteValue > threshold;
}
