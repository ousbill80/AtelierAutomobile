import type { AppointmentType, BayType } from "./types";
import { DEFAULT_DURATIONS } from "./settings";

/** RG-M03-04 — types de pont requis par type de RDV ; `null` = aucun pont particulier. */
export const REQUIRED_BAY_TYPES: Record<AppointmentType, readonly BayType[] | null> = {
  SERVICE: ["LIFT"],
  INSPECTION_PREP: ["LIFT", "DIAGNOSTIC"],
  REPAIR: ["LIFT"],
  DIAGNOSTIC: ["DIAGNOSTIC"],
  BODYWORK: ["BODYWORK"],
  TIRES: ["LIFT", "OTHER"],
  OTHER: null,
};

export function isBayCompatible(type: AppointmentType, bayType: BayType): boolean {
  const required = REQUIRED_BAY_TYPES[type];
  return required === null || required.includes(bayType);
}

/** Arrondi au quart d'heure supérieur (2 h 10 → 2 h 15). */
export function roundUpToQuarterHour(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.ceil(minutes / 15) * 15;
}

export interface DefaultDurationInput {
  type: AppointmentType;
  durations?: Partial<Record<AppointmentType, number>>;
  /** Opérations du catalogue prévues (`LaborOperation.standardHours`). */
  laborOperations?: ReadonlyArray<{ standardHours: number }>;
}

/**
 * RG-M03-04 — durée proposée : durée du type, ou somme des `standardHours` des opérations
 * arrondie au quart d'heure supérieur si elle dépasse la durée du type.
 * Ex. vidange 0,5 h + plaquettes 1 h + géométrie 0,75 h = 2 h 15 (135 min).
 */
export function defaultDuration(input: DefaultDurationInput): number {
  const base = input.durations?.[input.type] ?? DEFAULT_DURATIONS[input.type];
  const operations = input.laborOperations ?? [];
  if (operations.length === 0) {
    return base;
  }
  const totalHours = operations.reduce((sum, op) => sum + Math.max(0, op.standardHours), 0);
  const fromOperations = roundUpToQuarterHour(Math.round(totalHours * 60));
  return Math.max(base, fromOperations);
}

/** « 15 h 18 », « 14 h », « 6 h 30 » — affichage d'une durée en minutes (RG-M03-05). */
export function formatHoursMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, "0")}`;
}
