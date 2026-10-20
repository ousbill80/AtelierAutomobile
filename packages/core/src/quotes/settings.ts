// M05 §6 — `Organization.settings.quotes`.
import { DEFAULT_DISCOUNT_CAPS, type DiscountCaps } from "./discount";
import { ROLES } from "../auth/permissions";

export interface DepositRule {
  /** Seuil TTC à partir duquel l'acompte est demandé. */
  thresholdTtc: number;
  /** Pourcentage du total accepté. */
  rate: number;
}

export interface QuoteSettings {
  validityDays: number;
  validityDaysCompany: number;
  requireSignature: boolean;
  discountCaps: DiscountCaps;
  depositRule: DepositRule | null;
  /** Premier rappel si le véhicule est à l'atelier ("H+4"). */
  followupWhenVehicleOnSite: string;
  showLinePricesToCustomer: boolean;
  termsText: string;
}

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  validityDays: 15,
  validityDaysCompany: 30,
  requireSignature: true,
  discountCaps: DEFAULT_DISCOUNT_CAPS,
  depositRule: null,
  followupWhenVehicleOnSite: "H+4",
  showLinePricesToCustomer: true,
  termsText: "Devis valable 15 jours. Pièces commandées spécialement non reprises.",
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(source: Record<string, unknown>, key: string, fallback: number): number {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function quoteSettingsFrom(settings: unknown): QuoteSettings {
  const q = obj(obj(settings).quotes);
  const d = DEFAULT_QUOTE_SETTINGS;
  const capsRaw = obj(q.discountCaps);
  const discountCaps = Object.fromEntries(
    ROLES.map((role) => {
      const c = obj(capsRaw[role]);
      const def = d.discountCaps[role];
      return [role, { line: num(c, "line", def.line), global: num(c, "global", def.global) }];
    }),
  ) as DiscountCaps;
  const dep = obj(q.depositRule);
  const depositRule =
    typeof dep.thresholdTtc === "number" && typeof dep.rate === "number" && dep.rate > 0
      ? { thresholdTtc: dep.thresholdTtc, rate: dep.rate }
      : null;
  return {
    validityDays: num(q, "validityDays", d.validityDays),
    validityDaysCompany: num(q, "validityDaysCompany", d.validityDaysCompany),
    requireSignature:
      typeof q.requireSignature === "boolean" ? q.requireSignature : d.requireSignature,
    discountCaps,
    depositRule,
    followupWhenVehicleOnSite:
      typeof q.followupWhenVehicleOnSite === "string"
        ? q.followupWhenVehicleOnSite
        : d.followupWhenVehicleOnSite,
    showLinePricesToCustomer:
      typeof q.showLinePricesToCustomer === "boolean"
        ? q.showLinePricesToCustomer
        : d.showLinePricesToCustomer,
    termsText: typeof q.termsText === "string" ? q.termsText : d.termsText,
  };
}
