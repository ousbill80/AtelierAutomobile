// §5 (machine à états dérivés) — statuts affichés de la VT et de la révision.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 30;
const DUE_SOON_MILEAGE = 1000;

export type InspectionStatus = "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED";

/** RG-M02-12 — À jour (> 30 j), Bientôt (≤ 30 j), Expirée (< aujourd'hui), Inconnue (pas de date). */
export function inspectionStatus(
  expiryDate: Date | null | undefined,
  today: Date,
): InspectionStatus {
  if (!expiryDate) return "UNKNOWN";
  const daysRemaining = Math.floor((expiryDate.getTime() - today.getTime()) / MS_PER_DAY);
  if (daysRemaining < 0) return "EXPIRED";
  if (daysRemaining <= DUE_SOON_DAYS) return "DUE_SOON";
  return "OK";
}

export type ServiceDueStatus = "UNKNOWN" | "OK" | "DUE_SOON" | "OVERDUE";

/** §5 — Inconnue → OK → Bientôt (≤ 30 j ou ≤ 1 000 km) → Dépassée. */
export function serviceStatus(
  dueDate: Date | null | undefined,
  dueMileage: number | null | undefined,
  estimatedMileage: number | null | undefined,
  today: Date,
): ServiceDueStatus {
  if (!dueDate && dueMileage == null) return "UNKNOWN";

  const daysRemaining = dueDate
    ? Math.floor((dueDate.getTime() - today.getTime()) / MS_PER_DAY)
    : null;
  const kmRemaining =
    dueMileage != null && estimatedMileage != null ? dueMileage - estimatedMileage : null;

  if ((daysRemaining != null && daysRemaining < 0) || (kmRemaining != null && kmRemaining <= 0)) {
    return "OVERDUE";
  }
  if (
    (daysRemaining != null && daysRemaining <= DUE_SOON_DAYS) ||
    (kmRemaining != null && kmRemaining <= DUE_SOON_MILEAGE)
  ) {
    return "DUE_SOON";
  }
  return "OK";
}
