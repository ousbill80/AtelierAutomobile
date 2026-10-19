import type { AppointmentType } from "./types";
import { APPOINTMENT_TYPES } from "./types";

/** `Organization.settings.appointments` (M03 §6). */
export interface AppointmentSettings {
  durations: Record<AppointmentType, number>;
  slotStepMinutes: number;
  lateAfterMinutes: number;
  /** Heure locale (HH:mm) du passage automatique en NO_SHOW (RG-M03-10). */
  noShowJobTime: string;
  portalEnabled: boolean;
  portalTypes: AppointmentType[];
  portalRequiresApproval: boolean;
  portalMinLeadHours: number;
  portalHorizonDays: number;
  autoAssignBay: boolean;
  /** `null` = nombre de ponts actifs × 2 (RG-M03-05). */
  maxAppointmentsPerHalfDay: number | null;
}

/** `Organization.settings.planning` (M03 §6). */
export interface PlanningSettings {
  productivityRate: number;
  /** Pause déjeuner `["12:30","13:30"]` retirée des plages d'ouverture ; `null` = aucune. */
  lunchBreak: [string, string] | null;
}

/** RG-M03-04 — durées par défaut (minutes). */
export const DEFAULT_DURATIONS: Record<AppointmentType, number> = {
  SERVICE: 90,
  INSPECTION_PREP: 60,
  REPAIR: 120,
  DIAGNOSTIC: 60,
  BODYWORK: 30,
  TIRES: 45,
  OTHER: 60,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Fusionne `settings.appointments` (brut, JSON) avec les défauts ; tolère les clés manquantes ou invalides. */
export function resolveAppointmentSettings(raw: unknown): AppointmentSettings {
  const section = isRecord(raw) && isRecord(raw.appointments) ? raw.appointments : {};
  const rawDurations = isRecord(section.durations) ? section.durations : {};
  const durations = { ...DEFAULT_DURATIONS };
  for (const type of APPOINTMENT_TYPES) {
    const value = rawDurations[type];
    if (typeof value === "number" && Number.isInteger(value) && value >= 15) {
      durations[type] = value;
    }
  }
  const portalTypes = Array.isArray(section.portalTypes)
    ? section.portalTypes.filter((type): type is AppointmentType =>
        APPOINTMENT_TYPES.includes(type as AppointmentType),
      )
    : DEFAULT_APPOINTMENT_SETTINGS.portalTypes;
  const maxRaw = section.maxAppointmentsPerHalfDay;
  return {
    durations,
    slotStepMinutes: numberOr(
      section.slotStepMinutes,
      DEFAULT_APPOINTMENT_SETTINGS.slotStepMinutes,
    ),
    lateAfterMinutes: numberOr(
      section.lateAfterMinutes,
      DEFAULT_APPOINTMENT_SETTINGS.lateAfterMinutes,
    ),
    noShowJobTime:
      typeof section.noShowJobTime === "string" &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(section.noShowJobTime)
        ? section.noShowJobTime
        : DEFAULT_APPOINTMENT_SETTINGS.noShowJobTime,
    portalEnabled: booleanOr(section.portalEnabled, DEFAULT_APPOINTMENT_SETTINGS.portalEnabled),
    portalTypes: [...portalTypes],
    portalRequiresApproval: booleanOr(
      section.portalRequiresApproval,
      DEFAULT_APPOINTMENT_SETTINGS.portalRequiresApproval,
    ),
    portalMinLeadHours: numberOr(
      section.portalMinLeadHours,
      DEFAULT_APPOINTMENT_SETTINGS.portalMinLeadHours,
    ),
    portalHorizonDays: numberOr(
      section.portalHorizonDays,
      DEFAULT_APPOINTMENT_SETTINGS.portalHorizonDays,
    ),
    autoAssignBay: booleanOr(section.autoAssignBay, DEFAULT_APPOINTMENT_SETTINGS.autoAssignBay),
    maxAppointmentsPerHalfDay:
      typeof maxRaw === "number" && Number.isInteger(maxRaw) && maxRaw > 0 ? maxRaw : null,
  };
}

/** Fusionne `settings.planning` (brut, JSON) avec les défauts. */
export function resolvePlanningSettings(raw: unknown): PlanningSettings {
  const section = isRecord(raw) && isRecord(raw.planning) ? raw.planning : {};
  const rate = numberOr(section.productivityRate, DEFAULT_PLANNING_SETTINGS.productivityRate);
  const lunch = section.lunchBreak;
  const lunchBreak: [string, string] | null =
    Array.isArray(lunch) &&
    lunch.length === 2 &&
    typeof lunch[0] === "string" &&
    typeof lunch[1] === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(lunch[0]) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(lunch[1]) &&
    lunch[0] < lunch[1]
      ? [lunch[0], lunch[1]]
      : null;
  return {
    productivityRate: rate > 0 && rate <= 1 ? rate : DEFAULT_PLANNING_SETTINGS.productivityRate,
    lunchBreak,
  };
}
