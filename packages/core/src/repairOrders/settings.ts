// M04 §6 — `Organization.settings.repairOrders`, `settings.labor.rates` (A3), `settings.warranty`.
import { DEFAULT_LABOR_RATES, type LaborRates } from "./lines";
import { DEFAULT_WARRANTY_SETTINGS, type WarrantySettings } from "./warranty";

export interface QcChecklistItem {
  key: string;
  label: string;
}

/** RG-M04-13 — check-list de contrôle qualité par défaut. */
export const DEFAULT_QC_CHECKLIST: QcChecklistItem[] = [
  { key: "road_test", label: "Essai routier effectué" },
  { key: "levels", label: "Niveaux vérifiés" },
  { key: "wheel_torque", label: "Serrage des roues au couple" },
  { key: "no_warning_light", label: "Aucun voyant allumé" },
  { key: "clean", label: "Véhicule propre" },
  { key: "belongings", label: "Objets du client présents" },
  { key: "old_parts", label: "Anciennes pièces remises si demandées" },
];

export interface RepairOrderSettings {
  minCheckInPhotos: number;
  qcRequired: boolean;
  qcChecklist: QcChecklistItem[];
  autoDraftInvoiceOnReady: boolean;
  defaultAuthorizationCeiling: number;
  storageFeeEnabled: boolean;
  storageFeeAfterDays: number;
  storageFeePerDay: number;
  readyReminderAfterDays: number;
  /** RG-M04-07 : consommables en % de la MO (0 = désactivé). */
  consumablesRate: number;
}

export const DEFAULT_REPAIR_ORDER_SETTINGS: RepairOrderSettings = {
  minCheckInPhotos: 4,
  qcRequired: true,
  qcChecklist: DEFAULT_QC_CHECKLIST,
  autoDraftInvoiceOnReady: true,
  defaultAuthorizationCeiling: 0,
  storageFeeEnabled: false,
  storageFeeAfterDays: 7,
  storageFeePerDay: 2_000,
  readyReminderAfterDays: 3,
  consumablesRate: 0,
};

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

export function repairOrderSettingsFrom(settings: unknown): RepairOrderSettings {
  const ro = obj(obj(settings).repairOrders);
  const d = DEFAULT_REPAIR_ORDER_SETTINGS;
  const checklist = Array.isArray(ro.qcChecklist)
    ? (ro.qcChecklist as unknown[]).filter(
        (i): i is QcChecklistItem =>
          !!i &&
          typeof (i as QcChecklistItem).key === "string" &&
          typeof (i as QcChecklistItem).label === "string",
      )
    : d.qcChecklist;
  return {
    minCheckInPhotos: pickNumber(ro, "minCheckInPhotos", d.minCheckInPhotos),
    qcRequired: pickBool(ro, "qcRequired", d.qcRequired),
    qcChecklist: checklist.length > 0 ? checklist : d.qcChecklist,
    autoDraftInvoiceOnReady: pickBool(ro, "autoDraftInvoiceOnReady", d.autoDraftInvoiceOnReady),
    defaultAuthorizationCeiling: pickNumber(
      ro,
      "defaultAuthorizationCeiling",
      d.defaultAuthorizationCeiling,
    ),
    storageFeeEnabled: pickBool(ro, "storageFeeEnabled", d.storageFeeEnabled),
    storageFeeAfterDays: pickNumber(ro, "storageFeeAfterDays", d.storageFeeAfterDays),
    storageFeePerDay: pickNumber(ro, "storageFeePerDay", d.storageFeePerDay),
    readyReminderAfterDays: pickNumber(ro, "readyReminderAfterDays", d.readyReminderAfterDays),
    consumablesRate: pickNumber(ro, "consumablesRate", d.consumablesRate),
  };
}

/** A3 : `settings.labor.rates` (la clé `settings.laborRates` de M04 désigne la même chose). */
export function laborRatesFrom(settings: unknown): LaborRates {
  const s = obj(settings);
  const rates = obj(obj(s.labor).rates);
  const legacy = obj(s.laborRates);
  const source = Object.keys(rates).length > 0 ? rates : legacy;
  return {
    STANDARD: pickNumber(source, "STANDARD", DEFAULT_LABOR_RATES.STANDARD),
    DIAGNOSTIC: pickNumber(source, "DIAGNOSTIC", DEFAULT_LABOR_RATES.DIAGNOSTIC),
    BODYWORK: pickNumber(source, "BODYWORK", DEFAULT_LABOR_RATES.BODYWORK),
    ELECTRICAL: pickNumber(source, "ELECTRICAL", DEFAULT_LABOR_RATES.ELECTRICAL),
  };
}

export function warrantySettingsFrom(settings: unknown): WarrantySettings {
  const w = obj(obj(settings).warranty);
  const d = DEFAULT_WARRANTY_SETTINGS;
  return {
    laborMonths: pickNumber(w, "laborMonths", d.laborMonths),
    laborKm: pickNumber(w, "laborKm", d.laborKm),
    partMonths: pickNumber(w, "partMonths", d.partMonths),
    partKm: pickNumber(w, "partKm", d.partKm),
    customerSuppliedLaborMonths: pickNumber(
      w,
      "customerSuppliedLaborMonths",
      d.customerSuppliedLaborMonths,
    ),
  };
}

export type QcResult = "OK" | "NOK" | "NA";

/** RG-M04-13 : un seul NOK interdit READY ; chaque point de la check-list doit être renseigné. */
export function evaluateQc(
  checklist: readonly QcChecklistItem[],
  results: readonly { key: string; result: QcResult }[],
): { ok: boolean; nok: string[]; missing: string[] } {
  const byKey = new Map(results.map((r) => [r.key, r.result]));
  const missing = checklist.filter((i) => !byKey.has(i.key)).map((i) => i.key);
  const nok = results.filter((r) => r.result === "NOK").map((r) => r.key);
  return { ok: missing.length === 0 && nok.length === 0, nok, missing };
}
