// M03 §6 — paramètres `Organization.settings.appointments` et `settings.planning`.
// Les jours fériés ne sont PAS lus ici : source unique `Holiday` (04-arbitrages A1).
import type { AppointmentTypeKey, BayTypeKey } from "./types";

export interface AppointmentSettings {
  durations: Record<AppointmentTypeKey, number>;
  slotStepMinutes: number;
  lateAfterMinutes: number;
  noShowJobTime: string;
  portalEnabled: boolean;
  portalTypes: AppointmentTypeKey[];
  portalRequiresApproval: boolean;
  portalMinLeadHours: number;
  portalHorizonDays: number;
  autoAssignBay: boolean;
  /** `null` = nombre de ponts actifs × 2 (RG-M03-05). */
  maxAppointmentsPerHalfDay: number | null;
}

export interface PlanningSettings {
  productivityRate: number;
  /** Pause appliquée aux créneaux, « si configurée » (RG-M03-01 / US-M03-02). */
  lunchBreak: [string, string] | null;
}

export interface PlanningConfig {
  appointments: AppointmentSettings;
  planning: PlanningSettings;
}

/** RG-M03-04 — durées par défaut (minutes). */
export const DEFAULT_DURATIONS: Record<AppointmentTypeKey, number> = {
  SERVICE: 90,
  INSPECTION_PREP: 60,
  REPAIR: 120,
  DIAGNOSTIC: 60,
  BODYWORK: 30,
  TIRES: 45,
  OTHER: 60,
};

/** RG-M03-04 — type de pont requis (`null` = aucun). */
export const REQUIRED_BAY_TYPES: Record<AppointmentTypeKey, readonly BayTypeKey[] | null> = {
  SERVICE: ["LIFT"],
  INSPECTION_PREP: ["LIFT", "DIAGNOSTIC"],
  REPAIR: ["LIFT"],
  DIAGNOSTIC: ["DIAGNOSTIC"],
  BODYWORK: ["BODYWORK"],
  TIRES: ["LIFT", "OTHER"],
  OTHER: null,
};

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  durations: { ...DEFAULT_DURATIONS },
  slotStepMinutes: 15,
  lateAfterMinutes: 60,
  noShowJobTime: "20:00",
  portalEnabled: true,
  portalTypes: ["SERVICE", "INSPECTION_PREP", "DIAGNOSTIC", "TIRES"],
  portalRequiresApproval: false,
  portalMinLeadHours: 2,
  portalHorizonDays: 14,
  autoAssignBay: false,
  maxAppointmentsPerHalfDay: null,
};

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  productivityRate: 0.85,
  lunchBreak: null,
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Fusionne les paramètres stockés avec les défauts (clés inconnues ou invalides ignorées). */
export function resolvePlanningConfig(settings: unknown): PlanningConfig {
  const root = asObject(settings);
  const a = asObject(root.appointments);
  const p = asObject(root.planning);
  const durations = { ...DEFAULT_DURATIONS };
  for (const [key, value] of Object.entries(asObject(a.durations))) {
    if (key in durations && typeof value === "number" && value > 0) {
      durations[key as AppointmentTypeKey] = value;
    }
  }
  const pick = <T>(value: unknown, fallback: T, check: (v: unknown) => boolean): T =>
    check(value) ? (value as T) : fallback;
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const isBool = (v: unknown) => typeof v === "boolean";
  const d = DEFAULT_APPOINTMENT_SETTINGS;
  return {
    appointments: {
      durations,
      slotStepMinutes: pick(a.slotStepMinutes, d.slotStepMinutes, isNum),
      lateAfterMinutes: pick(a.lateAfterMinutes, d.lateAfterMinutes, isNum),
      noShowJobTime: pick(a.noShowJobTime, d.noShowJobTime, (v) => typeof v === "string"),
      portalEnabled: pick(a.portalEnabled, d.portalEnabled, isBool),
      portalTypes: pick(a.portalTypes, d.portalTypes, Array.isArray),
      portalRequiresApproval: pick(a.portalRequiresApproval, d.portalRequiresApproval, isBool),
      portalMinLeadHours: pick(a.portalMinLeadHours, d.portalMinLeadHours, isNum),
      portalHorizonDays: pick(a.portalHorizonDays, d.portalHorizonDays, isNum),
      autoAssignBay: pick(a.autoAssignBay, d.autoAssignBay, isBool),
      maxAppointmentsPerHalfDay: pick(
        a.maxAppointmentsPerHalfDay,
        d.maxAppointmentsPerHalfDay,
        (v) => v === null || isNum(v),
      ),
    },
    planning: {
      productivityRate: pick(
        p.productivityRate,
        DEFAULT_PLANNING_SETTINGS.productivityRate,
        (v) => isNum(v) && (v as number) > 0 && (v as number) <= 1,
      ),
      lunchBreak: pick(
        p.lunchBreak,
        DEFAULT_PLANNING_SETTINGS.lunchBreak,
        (v) => v === null || (Array.isArray(v) && v.length === 2),
      ),
    },
  };
}

export function isBayCompatible(type: AppointmentTypeKey, bayType: BayTypeKey): boolean {
  const required = REQUIRED_BAY_TYPES[type];
  return required === null || required.includes(bayType);
}
