// RG-M05-07 — plafonds de remise par rôle, motif obligatoire au-delà de 5 %.
import {
  DISCOUNT_REASON_THRESHOLD,
  type DiscountCap,
  type DiscountCapRole,
} from "./settings";

export interface DiscountCheckInput {
  role: DiscountCapRole | string;
  caps: Record<DiscountCapRole, DiscountCap>;
  /** Remises de ligne en %. */
  lineRates: readonly number[];
  /** Remise globale en %, 0 si en FCFA (vérifiée via `globalRateEquivalent`). */
  globalRate?: number | null;
  /** Équivalent en % d'une remise globale saisie en FCFA (montant / HT). */
  globalRateEquivalent?: number | null;
  /** `quote:discount_override` : plafond OWNER. */
  hasOverride?: boolean;
}

export type DiscountCheckResult =
  | { ok: true }
  | { ok: false; exceeded: "LINE" | "GLOBAL"; cap: number; requested: number };

/** Vérifie les remises contre le plafond du rôle (ou OWNER avec `quote:discount_override`). */
export function discountAllowed(input: DiscountCheckInput): DiscountCheckResult {
  const effectiveRole: DiscountCapRole = input.hasOverride
    ? "OWNER"
    : ((input.role in input.caps ? input.role : "CASHIER") as DiscountCapRole);
  const cap = input.caps[effectiveRole];
  const maxLine = Math.max(0, ...input.lineRates);
  if (maxLine > cap.line) {
    return { ok: false, exceeded: "LINE", cap: cap.line, requested: maxLine };
  }
  const global = Math.max(input.globalRate ?? 0, input.globalRateEquivalent ?? 0);
  if (global > cap.global) {
    return { ok: false, exceeded: "GLOBAL", cap: cap.global, requested: global };
  }
  return { ok: true };
}

/** RG-M05-07 : une remise > 5 % (ligne ou globale) exige un motif. */
export function discountRequiresReason(
  lineRates: readonly number[],
  globalRate: number | null | undefined,
): boolean {
  const maxLine = Math.max(0, ...lineRates);
  return maxLine > DISCOUNT_REASON_THRESHOLD || (globalRate ?? 0) > DISCOUNT_REASON_THRESHOLD;
}

/** Remise globale en FCFA → équivalent en % de l'assiette HT (pour comparer au plafond). */
export function globalDiscountRateEquivalent(amount: number, baseHt: number): number {
  if (baseHt <= 0) return amount > 0 ? 100 : 0;
  return Math.ceil((amount * 100) / baseHt);
}
