// RG-M03-02 — conflits de planning : un pont ne peut avoir deux occupations qui se
// chevauchent, un mécanicien ne peut avoir plus d'un RDV simultané. Bord à bord autorisé
// (09:00-10:30 suivi de 10:30-12:00 ne sont pas en conflit). `CANCELLED`/`NO_SHOW` ne bloquent
// pas ; une occupation `overbooked` ne bloque pas non plus (surréservation volontaire).

export interface OccupancyLike {
  id: string;
  bayId: string | null;
  mechanicId?: string | null;
  startsAt: Date;
  endsAt: Date;
  /** `AppointmentStatus` ou équivalent : les statuts terminaux/annulés ne bloquent jamais. */
  blocking: boolean;
  overbooked?: boolean;
}

export interface ConflictCandidate {
  excludeId?: string;
  bayId?: string | null;
  mechanicId?: string | null;
  startsAt: Date;
  endsAt: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Renvoie la première occupation en conflit avec `candidate` (même pont ou même mécanicien,
 * plage chevauchante, statut bloquant, non surréservée), ou `null` si aucune.
 */
export function detectConflicts(
  candidate: ConflictCandidate,
  existing: readonly OccupancyLike[],
): OccupancyLike | null {
  for (const occupancy of existing) {
    if (occupancy.id === candidate.excludeId) continue;
    if (!occupancy.blocking || occupancy.overbooked) continue;
    if (!overlaps(candidate.startsAt, candidate.endsAt, occupancy.startsAt, occupancy.endsAt)) {
      continue;
    }
    const sameBay =
      candidate.bayId != null && occupancy.bayId != null && candidate.bayId === occupancy.bayId;
    const sameMechanic =
      candidate.mechanicId != null &&
      occupancy.mechanicId != null &&
      candidate.mechanicId === occupancy.mechanicId;
    if (sameBay || sameMechanic) return occupancy;
  }
  return null;
}
