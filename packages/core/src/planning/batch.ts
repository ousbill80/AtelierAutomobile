// US-M03-12 / RG-M03-14 — placement groupé de véhicules d'une flotte sur une journée.
import { overlaps } from "./time";
import type { Interval } from "./types";

export interface BatchBay {
  id: string;
  busy: readonly Interval[];
}

export interface BatchPlacementInput {
  vehicleIds: readonly string[];
  /** Débuts possibles triés (déjà dans les horaires et hors délai minimum). */
  candidateStarts: readonly Date[];
  durationMinutes: number;
  bays: readonly BatchBay[];
  maxParallel: number;
}

export interface BatchPlacement {
  vehicleId: string;
  startsAt: Date;
  endsAt: Date;
  bayId: string;
}

export function batchPlacement(input: BatchPlacementInput): {
  placed: BatchPlacement[];
  unplaced: string[];
} {
  const placed: BatchPlacement[] = [];
  const unplaced: string[] = [];
  for (const vehicleId of input.vehicleIds) {
    let done = false;
    for (const startsAt of input.candidateStarts) {
      const slot = {
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
      };
      const parallel = placed.filter((p) => overlaps(p, slot)).length;
      if (parallel >= input.maxParallel) continue;
      const bay = input.bays.find(
        (b) =>
          !b.busy.some((i) => overlaps(i, slot)) &&
          !placed.some((p) => p.bayId === b.id && overlaps(p, slot)),
      );
      if (!bay) continue;
      placed.push({ vehicleId, ...slot, bayId: bay.id });
      done = true;
      break;
    }
    if (!done) unplaced.push(vehicleId);
  }
  return { placed, unplaced };
}
