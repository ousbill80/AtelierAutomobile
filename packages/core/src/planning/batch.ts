import type { HalfDayWindow } from "./capacity";
import { findFreeBay } from "./available-slots";
import type {
  AppointmentLike,
  AppointmentType,
  BayLike,
  BlockLike,
  OccupyingOrderLike,
} from "./types";

export interface BatchPlacementInput {
  vehicleIds: readonly string[];
  type: AppointmentType;
  durationMinutes: number;
  stepMinutes: number;
  /** Demi-journées du jour choisi (dans l'ordre). */
  windows: readonly HalfDayWindow[];
  /** Instant minimal (now + délai). */
  earliest?: Date;
  bays: readonly BayLike[];
  appointments: readonly AppointmentLike[];
  blocks?: readonly BlockLike[];
  occupyingOrders?: readonly OccupyingOrderLike[];
  /** Véhicules traités en parallèle au maximum sur un même créneau (défaut 2). */
  maxParallel?: number;
}

export interface BatchPlacement {
  vehicleId: string;
  startsAt: Date;
  endsAt: Date;
  bayId: string;
}

export interface BatchPlacementResult {
  placed: BatchPlacement[];
  unplaced: string[];
}

/**
 * US-M03-12 / RG-M03-14 — répartit N véhicules sur les créneaux libres d'une journée,
 * au plus `maxParallel` en parallèle, chacun sur un pont compatible distinct.
 */
export function batchPlacement(input: BatchPlacementInput): BatchPlacementResult {
  const maxParallel = Math.max(1, input.maxParallel ?? 2);
  const durationMs = input.durationMinutes * 60_000;
  const stepMs = Math.max(5, input.stepMinutes) * 60_000;
  const remaining = [...input.vehicleIds];
  const placed: BatchPlacement[] = [];
  // Les RDV placés deviennent des occupations pour les itérations suivantes.
  const occupied: AppointmentLike[] = [...input.appointments];

  for (const window of input.windows) {
    for (let t = window.start.getTime(); t + durationMs <= window.end.getTime(); t += stepMs) {
      if (remaining.length === 0) break;
      const startsAt = new Date(t);
      if (input.earliest && startsAt < input.earliest) continue;
      const endsAt = new Date(t + durationMs);
      let parallel = 0;
      while (parallel < maxParallel && remaining.length > 0) {
        const bay = findFreeBay({
          bays: input.bays,
          type: input.type,
          appointments: occupied,
          blocks: input.blocks,
          occupyingOrders: input.occupyingOrders,
          startsAt,
          endsAt,
          dayEnd: window.end,
        });
        if (!bay) break;
        const vehicleId = remaining.shift()!;
        placed.push({ vehicleId, startsAt, endsAt, bayId: bay.id });
        occupied.push({
          id: `batch-${vehicleId}`,
          bayId: bay.id,
          mechanicId: null,
          vehicleId,
          startsAt,
          endsAt,
          status: "BOOKED",
        });
        parallel += 1;
      }
      if (parallel >= maxParallel) {
        // Créneau rempli : le prochain groupe commence à la fin de celui-ci.
        t += durationMs - stepMs;
      }
    }
  }
  return { placed, unplaced: remaining };
}
