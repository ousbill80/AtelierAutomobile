// RG-M03-02 — conflits de pont, de mécanicien, blocages (ResourceBlock) et OR occupant un pont.
// Contrôle applicatif (messages lisibles) ; la contrainte d'exclusion Postgres reste le filet.
import { NON_BLOCKING_STATUSES, type AppointmentStatusKey, type Interval } from "./types";
import { overlaps } from "./time";

export interface ExistingAppointment extends Interval {
  id: string;
  bayId: string | null;
  mechanicId: string | null;
  status: AppointmentStatusKey;
  customerName?: string;
}

export interface BlockLike extends Interval {
  id: string;
  bayId: string | null;
  membershipId: string | null;
  reason: string;
}

/** OR en cours occupant un pont jusqu'à `endsAt` (= `promisedAt` ou fin de journée). */
export interface OccupyingOrder extends Interval {
  id: string;
  bayId: string;
  label?: string;
}

export type ConflictKind =
  "BAY" | "MECHANIC" | "BAY_BLOCKED" | "MECHANIC_ABSENT" | "SITE_CLOSED" | "REPAIR_ORDER";

export interface Conflict extends Interval {
  kind: ConflictKind;
  conflictingId: string;
  label?: string;
}

export interface ConflictCandidate extends Interval {
  bayId: string | null;
  mechanicId: string | null;
  /** RDV modifié : ne pas entrer en conflit avec lui-même. */
  excludeId?: string;
}

export interface ConflictSources {
  appointments: readonly ExistingAppointment[];
  blocks?: readonly BlockLike[];
  orders?: readonly OccupyingOrder[];
}

export function isBlocking(status: AppointmentStatusKey): boolean {
  return !NON_BLOCKING_STATUSES.includes(status);
}

/** Liste des conflits (vide = posable). Bord à bord autorisé (09:00-10:30 / 10:30-12:00). */
export function detectConflicts(
  candidate: ConflictCandidate,
  sources: ConflictSources,
): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const appt of sources.appointments) {
    if (appt.id === candidate.excludeId || !isBlocking(appt.status)) continue;
    if (!overlaps(candidate, appt)) continue;
    const base = {
      conflictingId: appt.id,
      startsAt: appt.startsAt,
      endsAt: appt.endsAt,
      label: appt.customerName,
    };
    if (candidate.bayId && appt.bayId === candidate.bayId) conflicts.push({ kind: "BAY", ...base });
    else if (candidate.mechanicId && appt.mechanicId === candidate.mechanicId) {
      conflicts.push({ kind: "MECHANIC", ...base });
    }
  }
  for (const block of sources.blocks ?? []) {
    if (!overlaps(candidate, block)) continue;
    const base = {
      conflictingId: block.id,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      label: block.reason,
    };
    if (!block.bayId && !block.membershipId) conflicts.push({ kind: "SITE_CLOSED", ...base });
    else if (block.bayId && block.bayId === candidate.bayId)
      conflicts.push({ kind: "BAY_BLOCKED", ...base });
    else if (block.membershipId && block.membershipId === candidate.mechanicId) {
      conflicts.push({ kind: "MECHANIC_ABSENT", ...base });
    }
  }
  for (const order of sources.orders ?? []) {
    if (candidate.bayId && order.bayId === candidate.bayId && overlaps(candidate, order)) {
      conflicts.push({
        kind: "REPAIR_ORDER",
        conflictingId: order.id,
        startsAt: order.startsAt,
        endsAt: order.endsAt,
        label: order.label,
      });
    }
  }
  return conflicts;
}

/** Vrai si le pont est libre sur l'intervalle (ni RDV, ni blocage pont/site, ni OR). */
export function isBayFree(
  bayId: string,
  interval: Interval,
  sources: ConflictSources,
  excludeId?: string,
): boolean {
  return (
    detectConflicts({ ...interval, bayId, mechanicId: null, excludeId }, sources).filter(
      (c) => c.kind !== "MECHANIC" && c.kind !== "MECHANIC_ABSENT",
    ).length === 0
  );
}
