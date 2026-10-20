// M14 §6 — `Organization.settings.portal` avec valeurs par défaut.

export interface PortalSettings {
  enabled: boolean;
  domain: string | null;
  primaryColor: string | null;
  requireSignature: boolean;
  allowPartialPayment: boolean;
  minPartialAmount: number;
  showMeasurements: boolean;
  showTechnicianName: boolean;
  bookingEnabled: boolean;
  bookingHorizonDays: number;
  cancelCutoffHours: number;
  googleReviewUrl: string | null;
  otpLoginEnabled: boolean;
}

export const DEFAULT_PORTAL_SETTINGS: PortalSettings = {
  enabled: true,
  domain: null,
  primaryColor: null,
  requireSignature: true,
  allowPartialPayment: false,
  minPartialAmount: 5000,
  showMeasurements: true,
  showTechnicianName: false,
  bookingEnabled: true,
  bookingHorizonDays: 14,
  cancelCutoffHours: 2,
  googleReviewUrl: null,
  otpLoginEnabled: true,
};

const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function pick<T>(value: unknown, fallback: T, guard: (v: unknown) => boolean): T {
  return guard(value) ? (value as T) : fallback;
}

export function portalSettingsFrom(settings: unknown): PortalSettings {
  const root = (settings && typeof settings === "object" ? settings : {}) as Record<
    string,
    unknown
  >;
  const p = (root.portal && typeof root.portal === "object" ? root.portal : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_PORTAL_SETTINGS;
  return {
    enabled: pick(p.enabled, d.enabled, isBool),
    domain: pick(p.domain, d.domain, isStr),
    primaryColor: pick(p.primaryColor, d.primaryColor, isStr),
    requireSignature: pick(p.requireSignature, d.requireSignature, isBool),
    allowPartialPayment: pick(p.allowPartialPayment, d.allowPartialPayment, isBool),
    minPartialAmount: pick(p.minPartialAmount, d.minPartialAmount, isNum),
    showMeasurements: pick(p.showMeasurements, d.showMeasurements, isBool),
    showTechnicianName: pick(p.showTechnicianName, d.showTechnicianName, isBool),
    bookingEnabled: pick(p.bookingEnabled, d.bookingEnabled, isBool),
    bookingHorizonDays: pick(p.bookingHorizonDays, d.bookingHorizonDays, isNum),
    cancelCutoffHours: pick(p.cancelCutoffHours, d.cancelCutoffHours, isNum),
    googleReviewUrl: pick(p.googleReviewUrl, d.googleReviewUrl, isStr),
    otpLoginEnabled: pick(p.otpLoginEnabled, d.otpLoginEnabled, isBool),
  };
}

/** Slug d'organisation (`/p/connexion?g={slug}`) : nom simplifié + suffixe pour l'unicité. */
export function organizationSlug(name: string, suffix: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  const tail = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(-6);
  return [base || "garage", tail].filter(Boolean).join("-");
}
