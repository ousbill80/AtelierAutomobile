// RG-M03-14 / US-M03-12 — RDV groupés (flotte) : répartit plusieurs véhicules sur les créneaux
// libres d'un jour, au plus `maxParallel` par horodatage de départ (défaut 2), dans l'ordre
// chronologique. Les véhicules en trop faute de créneaux restent `unplaced`.

export interface PlaceableSlot {
  startsAt: Date;
  bayId: string | null;
}

export interface BatchPlacementInput {
  vehicleIds: readonly string[];
  /** Créneaux libres du jour (plusieurs ponts peuvent partager le même horodatage). */
  availableSlots: readonly PlaceableSlot[];
  maxParallel?: number;
}

export interface BatchPlacement {
  vehicleId: string;
  startsAt: Date;
  bayId: string | null;
}

export interface BatchPlacementResult {
  placements: BatchPlacement[];
  unplaced: string[];
}

export function batchPlacement(input: BatchPlacementInput): BatchPlacementResult {
  const maxParallel = input.maxParallel ?? 2;

  const byStartTime = new Map<number, PlaceableSlot[]>();
  for (const slot of input.availableSlots) {
    const key = slot.startsAt.getTime();
    const group = byStartTime.get(key);
    if (group) group.push(slot);
    else byStartTime.set(key, [slot]);
  }
  const orderedStartTimes = [...byStartTime.keys()].sort((a, b) => a - b);

  const placements: BatchPlacement[] = [];
  const remaining = [...input.vehicleIds];

  for (const startTime of orderedStartTimes) {
    if (remaining.length === 0) break;
    const slotsAtThisTime = byStartTime.get(startTime)!;
    const take = Math.min(maxParallel, slotsAtThisTime.length, remaining.length);
    for (let i = 0; i < take; i++) {
      const vehicleId = remaining.shift()!;
      const slot = slotsAtThisTime[i]!;
      placements.push({ vehicleId, startsAt: slot.startsAt, bayId: slot.bayId });
    }
  }

  return { placements, unplaced: remaining };
}
