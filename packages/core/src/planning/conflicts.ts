import type { AppointmentLike, AppointmentStatus, BlockLike, OccupyingOrderLike } from "./types";

/** Statuts qui occupent réellement une ressource (RG-M03-02 : CANCELLED et NO_SHOW ne bloquent pas). */
export const BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
];

/** Chevauchement d'intervalles demi-ouverts : le bord à bord (09:00-10:30 / 10:30-12:00) est autorisé. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export type Conflict =
  | { kind: "BAY_APPOINTMENT"; appointment: AppointmentLike }
  | { kind: "MECHANIC_APPOINTMENT"; appointment: AppointmentLike }
  | { kind: "BAY_BLOCK"; block: BlockLike }
  | { kind: "MECHANIC_BLOCK"; block: BlockLike }
  | { kind: "SITE_BLOCK"; block: BlockLike }
  | { kind: "BAY_ORDER"; order: OccupyingOrderLike };

export interface DetectConflictsInput {
  startsAt: Date;
  endsAt: Date;
  bayId?: string | null;
  mechanicId?: string | null;
  /** RDV en cours de modification, ignoré dans la détection. */
  excludeAppointmentId?: string | null;
  appointments: readonly AppointmentLike[];
  blocks?: readonly BlockLike[];
  occupyingOrders?: readonly OccupyingOrderLike[];
  /** Fin de journée utilisée pour un OR sans `promisedAt` (RG-M03-02). */
  dayEnd?: Date;
}

/**
 * RG-M03-02 — conflits de ressources pour un créneau : RDV sur le même pont ou le même
 * mécanicien, blocages (pont, mécanicien, site entier), OR en cours occupant le pont.
 * Pur : l'appelant fournit les enregistrements de la plage concernée.
 */
export function detectConflicts(input: DetectConflictsInput): Conflict[] {
  const { startsAt, endsAt } = input;
  const bayId = input.bayId ?? null;
  const mechanicId = input.mechanicId ?? null;
  const conflicts: Conflict[] = [];

  for (const appointment of input.appointments) {
    if (appointment.id === input.excludeAppointmentId) continue;
    if (!BLOCKING_STATUSES.includes(appointment.status)) continue;
    if (!overlaps(startsAt, endsAt, appointment.startsAt, appointment.endsAt)) continue;
    if (bayId && appointment.bayId === bayId) {
      conflicts.push({ kind: "BAY_APPOINTMENT", appointment });
    }
    if (mechanicId && appointment.mechanicId === mechanicId) {
      conflicts.push({ kind: "MECHANIC_APPOINTMENT", appointment });
    }
  }

  for (const block of input.blocks ?? []) {
    if (!overlaps(startsAt, endsAt, block.startsAt, block.endsAt)) continue;
    if (block.bayId === null && block.membershipId === null) {
      conflicts.push({ kind: "SITE_BLOCK", block });
    } else if (bayId && block.bayId === bayId) {
      conflicts.push({ kind: "BAY_BLOCK", block });
    } else if (mechanicId && block.membershipId === mechanicId) {
      conflicts.push({ kind: "MECHANIC_BLOCK", block });
    }
  }

  if (bayId) {
    for (const order of input.occupyingOrders ?? []) {
      if (order.bayId !== bayId) continue;
      const until = order.promisedAt ?? input.dayEnd;
      if (!until) continue;
      // Un OR en cours occupe le pont depuis « maintenant » (début de la plage examinée) jusqu'à `until`.
      if (startsAt < until) {
        conflicts.push({ kind: "BAY_ORDER", order });
      }
    }
  }

  return conflicts;
}

/** Vrai si un pont est libre sur la plage (aucun conflit de type pont). */
export function isBayFree(
  bayId: string,
  input: Omit<DetectConflictsInput, "bayId" | "mechanicId">,
): boolean {
  return (
    detectConflicts({ ...input, bayId }).filter((c) => c.kind !== "MECHANIC_APPOINTMENT").length ===
    0
  );
}
