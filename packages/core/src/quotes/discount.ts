// RG-M05-07 — plafonds de remise par rôle (`settings.quotes.discountCaps`).
import type { Role } from "../auth/permissions";

export interface DiscountCap {
  /** Remise max par ligne (%). */
  line: number;
  /** Remise globale max (%). */
  global: number;
}

export type DiscountCaps = Record<Role, DiscountCap>;

export const DEFAULT_DISCOUNT_CAPS: DiscountCaps = {
  OWNER: { line: 100, global: 100 },
  MANAGER: { line: 20, global: 15 },
  ADVISOR: { line: 10, global: 5 },
  CASHIER: { line: 0, global: 0 },
  MECHANIC: { line: 0, global: 0 },
  STOREKEEPER: { line: 0, global: 0 },
  ACCOUNTANT: { line: 0, global: 0 },
};

/** Au-delà de 5 %, un motif de remise est obligatoire. */
export const DISCOUNT_REASON_THRESHOLD = 5;

export interface DiscountCheckInput {
  role: Role;
  caps: DiscountCaps;
  /** Remises de ligne (%). */
  lineRates: readonly number[];
  /** Remise globale effective (%). */
  globalRate: number;
  /** `quote:discount_override` : plafond porté à celui de OWNER. */
  hasOverride: boolean;
}

export interface DiscountCheckResult {
  /** Toutes les remises sont dans le plafond applicable. */
  withinCaps: boolean;
  /** Indices des lignes au-delà du plafond. */
  overLines: number[];
  overGlobal: boolean;
  cap: DiscountCap;
  /** Plus forte remise demandée (%), ligne ou globale. */
  maxRequested: number;
  reasonRequired: boolean;
}

/** `discountAllowed(role, caps, lineRate, globalRate, overridePerm)` du §12. */
export function checkDiscounts(input: DiscountCheckInput): DiscountCheckResult {
  const cap = input.hasOverride
    ? input.caps.OWNER
    : (input.caps[input.role] ?? { line: 0, global: 0 });
  const overLines = input.lineRates
    .map((rate, i) => (rate > cap.line ? i : -1))
    .filter((i) => i >= 0);
  const overGlobal = input.globalRate > cap.global;
  const maxRequested = Math.max(0, input.globalRate, ...input.lineRates);
  return {
    withinCaps: overLines.length === 0 && !overGlobal,
    overLines,
    overGlobal,
    cap,
    maxRequested,
    reasonRequired: maxRequested > DISCOUNT_REASON_THRESHOLD,
  };
}

/** Réduit les remises au plafond `maxRate` (« Approuver à 10 % »). */
export function clampRates(rates: readonly number[], maxRate: number): number[] {
  return rates.map((r) => Math.min(r, Math.max(0, maxRate)));
}
