// RG-M03-05 — capacité de l'atelier pour une demi-journée.
// Capacité = Σ heures disponibles des mécaniciens présents × productivityRate (défaut 0,85).
// Charge = Σ durée des RDV non annulés + travaux restants estimés des OR en cours.
// Exemple RG-M03-05 : 3 mécaniciens × 6 h × 0,85 = 15,3 h (918 min) de capacité ; 12 h (720 min)
// déjà réservées → un RDV de 2 h est accepté (14 h ≤ 15,3 h), un second est refusé (16 h > 15,3 h).

export interface ComputeCapacityInput {
  /** Heures disponibles de chaque mécanicien présent ce jour-là pour la demi-journée. */
  mechanicHoursAvailable: readonly number[];
  productivityRate?: number;
  /** Charge déjà engagée (RDV non annulés + travaux restants estimés des OR en cours), en minutes. */
  existingLoadMinutes: number;
  existingAppointmentsCount: number;
  activeBaysCount: number;
  /** `null`/absent = `activeBaysCount * 2` (défaut RG-M03-05). */
  maxAppointmentsPerHalfDay?: number | null;
  /** Durée du nouveau RDV à tester ; omis = simple lecture de la capacité restante. */
  candidateDurationMinutes?: number;
}

export type CapacityRejectionReason = "CAPACITY_EXCEEDED" | "MAX_APPOINTMENTS_REACHED";

export interface CapacityResult {
  capacityMinutes: number;
  loadBeforeMinutes: number;
  loadAfterMinutes: number;
  accepted: boolean;
  reason?: CapacityRejectionReason;
}

export function computeCapacity(input: ComputeCapacityInput): CapacityResult {
  const productivityRate = input.productivityRate ?? 0.85;
  const totalAvailableMinutes =
    input.mechanicHoursAvailable.reduce((sum, hours) => sum + hours, 0) * 60;
  const capacityMinutes = Math.round(totalAvailableMinutes * productivityRate);
  const candidateDuration = input.candidateDurationMinutes ?? 0;
  const loadAfterMinutes = input.existingLoadMinutes + candidateDuration;
  const maxAppointments = input.maxAppointmentsPerHalfDay ?? input.activeBaysCount * 2;

  let reason: CapacityRejectionReason | undefined;
  if (candidateDuration > 0 && input.existingAppointmentsCount + 1 > maxAppointments) {
    reason = "MAX_APPOINTMENTS_REACHED";
  } else if (loadAfterMinutes > capacityMinutes) {
    reason = "CAPACITY_EXCEEDED";
  }

  return {
    capacityMinutes,
    loadBeforeMinutes: input.existingLoadMinutes,
    loadAfterMinutes,
    accepted: reason === undefined,
    reason,
  };
}
