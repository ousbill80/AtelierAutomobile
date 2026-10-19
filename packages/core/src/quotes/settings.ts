// M05 §6 — `Organization.settings.quotes` : validité, signature, plafonds de remise, acompte,
// relance véhicule sur place, affichage des prix, conditions imprimées.

export type DiscountCapRole =
  | "OWNER"
  | "MANAGER"
  | "ADVISOR"
  | "CASHIER"
  | "MECHANIC"
  | "STOREKEEPER"
  | "ACCOUNTANT";

export interface DiscountCap {
  /** Remise maximale par ligne, en %. */
  line: number;
  /** Remise globale maximale, en %. */
  global: number;
}

/** RG-M05-07 — plafonds par défaut. Les rôles absents du PRD ne peuvent pas remiser. */
export const DEFAULT_DISCOUNT_CAPS: Record<DiscountCapRole, DiscountCap> = {
  OWNER: { line: 100, global: 100 },
  MANAGER: { line: 20, global: 15 },
  ADVISOR: { line: 10, global: 5 },
  CASHIER: { line: 0, global: 0 },
  MECHANIC: { line: 0, global: 0 },
  STOREKEEPER: { line: 0, global: 0 },
  ACCOUNTANT: { line: 0, global: 0 },
};

export interface DepositRule {
  /** Seuil TTC accepté à partir duquel un acompte est demandé. */
  thresholdTtc: number;
  /** Pourcentage de l'acompte. */
  rate: number;
}

export interface QuoteSettings {
  validityDays: number;
  validityDaysCompany: number;
  requireSignature: boolean;
  discountCaps: Record<DiscountCapRole, DiscountCap>;
  depositRule: DepositRule | null;
  /** RG-M05 US-09 : premier rappel quand le véhicule est à l'atelier ("H+4"). */
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

/** RG-M05-07 : au-delà de 5 %, toute remise exige un motif. */
export const DISCOUNT_REASON_THRESHOLD = 5;

/** §11 : signature obligatoire au-delà de 1 000 000 FCFA, même si désactivée. */
export const SIGNATURE_ALWAYS_REQUIRED_ABOVE = 1_000_000;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const v = source[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickBool(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = source[key];
  return typeof v === "boolean" ? v : fallback;
}

function pickString(source: Record<string, unknown>, key: string, fallback: string): string {
  const v = source[key];
  return typeof v === "string" ? v : fallback;
}

export function discountCapsFrom(raw: unknown): Record<DiscountCapRole, DiscountCap> {
  const source = obj(raw);
  const caps = { ...DEFAULT_DISCOUNT_CAPS };
  for (const role of Object.keys(DEFAULT_DISCOUNT_CAPS) as DiscountCapRole[]) {
    const entry = obj(source[role]);
    caps[role] = {
      line: Math.min(100, Math.max(0, pickNumber(entry, "line", DEFAULT_DISCOUNT_CAPS[role].line))),
      global: Math.min(
        100,
        Math.max(0, pickNumber(entry, "global", DEFAULT_DISCOUNT_CAPS[role].global)),
      ),
    };
  }
  return caps;
}

export function depositRuleFrom(raw: unknown): DepositRule | null {
  if (raw === null || raw === undefined) return null;
  const source = obj(raw);
  const thresholdTtc = pickNumber(source, "thresholdTtc", NaN);
  const rate = pickNumber(source, "rate", NaN);
  if (!Number.isFinite(thresholdTtc) || !Number.isFinite(rate) || rate <= 0) return null;
  return { thresholdTtc: Math.max(0, thresholdTtc), rate: Math.min(100, rate) };
}

export function quoteSettingsFrom(settings: unknown): QuoteSettings {
  const q = obj(obj(settings).quotes);
  const d = DEFAULT_QUOTE_SETTINGS;
  return {
    validityDays: Math.max(1, pickNumber(q, "validityDays", d.validityDays)),
    validityDaysCompany: Math.max(1, pickNumber(q, "validityDaysCompany", d.validityDaysCompany)),
    requireSignature: pickBool(q, "requireSignature", d.requireSignature),
    discountCaps: discountCapsFrom(q.discountCaps),
    depositRule: "depositRule" in q ? depositRuleFrom(q.depositRule) : d.depositRule,
    followupWhenVehicleOnSite: pickString(
      q,
      "followupWhenVehicleOnSite",
      d.followupWhenVehicleOnSite,
    ),
    showLinePricesToCustomer: pickBool(q, "showLinePricesToCustomer", d.showLinePricesToCustomer),
    termsText: pickString(q, "termsText", d.termsText),
  };
}
