// RG-M03-05 / RG-M03-06 — capacité d'une demi-journée et contrôle de charge.
import type { BlockLike } from "./conflicts";
import type { OpeningContext } from "./openingHours";
import { openIntervalsForDay } from "./openingHours";
import { hhmmToMinutes, overlapMinutes, zonedInstant } from "./time";
import type { HalfDay, Interval } from "./types";

/** Frontière matin / après-midi : début de la pause si configurée, sinon 13:00. */
export function halfDayBoundary(lunchBreak?: readonly [string, string] | null): number {
  return lunchBreak ? hhmmToMinutes(lunchBreak[0]) : 13 * 60;
}

export function halfDayOfMinutes(minutes: number, boundary: number): HalfDay {
  return minutes < boundary ? "AM" : "PM";
}

/** Plages ouvertes d'une demi-journée, en instants UTC. */
export function halfDayIntervals(
  dateKey: string,
  halfDay: HalfDay,
  ctx: OpeningContext,
): Interval[] {
  const boundary = halfDayBoundary(ctx.lunchBreak);
  return openIntervalsForDay(dateKey, ctx)
    .map(([from, to]): [number, number] =>
      halfDay === "AM" ? [from, Math.min(to, boundary)] : [Math.max(from, boundary), to],
    )
    .filter(([from, to]) => to > from)
    .map(([from, to]) => ({
      startsAt: zonedInstant(dateKey, from, ctx.timeZone),
      endsAt: zonedInstant(dateKey, to, ctx.timeZone),
    }));
}

/** Minutes disponibles d'un mécanicien sur des plages, déduction faite de ses blocages et des fermetures du site. */
export function mechanicAvailableMinutes(
  membershipId: string,
  intervals: readonly Interval[],
  blocks: readonly BlockLike[],
): number {
  let total = 0;
  for (const interval of intervals) {
    const open = overlapMinutes(interval, interval);
    const blocked = blocks
      .filter((b) => b.membershipId === membershipId || (!b.membershipId && !b.bayId))
      .reduce((sum, b) => sum + overlapMinutes(interval, b), 0);
    total += Math.max(0, open - blocked);
  }
  return total;
}

/**
 * Capacité = Σ heures disponibles des mécaniciens présents × productivité (minutes, arrondi
 * à l'inférieur). Exemple RG-M03-05 : 3 × 360 min × 0,85 = 918 min (15 h 18).
 */
export function computeCapacity(
  mechanicMinutes: readonly number[],
  productivityRate: number,
): number {
  return Math.floor(mechanicMinutes.reduce((s, m) => s + m, 0) * productivityRate);
}

export interface CapacityCheckInput {
  /** `null` = capacité inconnue (aucun mécanicien enregistré) : pas de contrôle de charge. */
  capacityMinutes: number | null;
  loadMinutes: number;
  durationMinutes: number;
  appointmentsCount: number;
  /** `null` = pas de plafond (aucun pont actif). */
  maxAppointments: number | null;
}

export type CapacityCheckResult =
  | { ok: true }
  | { ok: false; reason: "CAPACITY_EXCEEDED"; load: number; capacity: number }
  | { ok: false; reason: "MAX_APPOINTMENTS"; count: number; max: number };

export function checkCapacity(input: CapacityCheckInput): CapacityCheckResult {
  if (input.maxAppointments !== null && input.appointmentsCount >= input.maxAppointments) {
    return {
      ok: false,
      reason: "MAX_APPOINTMENTS",
      count: input.appointmentsCount,
      max: input.maxAppointments,
    };
  }
  if (
    input.capacityMinutes !== null &&
    input.loadMinutes + input.durationMinutes > input.capacityMinutes
  ) {
    return {
      ok: false,
      reason: "CAPACITY_EXCEEDED",
      load: input.loadMinutes + input.durationMinutes,
      capacity: input.capacityMinutes,
    };
  }
  return { ok: true };
}

/** RG-M03-05 : plafond par défaut = ponts actifs × 2 ; `null` si aucun pont. */
export function maxAppointmentsPerHalfDay(
  configured: number | null,
  activeBays: number,
): number | null {
  if (configured !== null) return configured;
  return activeBays > 0 ? activeBays * 2 : null;
}

/** US-M03-11 : jauge d'occupation (vert < 70 %, orange 70-90 %, rouge > 90 %). */
export function occupancyTone(ratio: number): "ok" | "warn" | "bad" {
  if (ratio > 0.9) return "bad";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

/** « 14 h », « 15 h 18 », « 45 min » (affichage des charges et capacités). */
export function formatMinutesFr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
