// RG-M03-04 — durée proposée : celle du type, ou la somme des temps barème des opérations
// prévues arrondie au quart d'heure supérieur si elle est plus longue.
import type { AppointmentTypeKey } from "./types";
import { DEFAULT_DURATIONS } from "./settings";

export function defaultDuration(
  type: AppointmentTypeKey,
  standardHours: readonly number[] = [],
  durations: Record<AppointmentTypeKey, number> = DEFAULT_DURATIONS,
): number {
  const typeMinutes = durations[type];
  const totalHours = standardHours.reduce((sum, h) => sum + (h > 0 ? h : 0), 0);
  // Arrondi au quart d'heure en travaillant en minutes entières (évite 2,25 h × 60 = 134,999…).
  const operationsMinutes = Math.ceil(Math.round(totalHours * 600) / 10 / 15) * 15;
  return Math.max(typeMinutes, operationsMinutes);
}

/** Pas de redimensionnement / grille : arrondit une durée au pas (≥ un pas). */
export function snapDuration(minutes: number, step = 15): number {
  return Math.max(step, Math.round(minutes / step) * step);
}
