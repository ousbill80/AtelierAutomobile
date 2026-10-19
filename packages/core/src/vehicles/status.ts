import { differenceInCalendarDays } from "date-fns";

export type InspectionStatus = "UNKNOWN" | "OK" | "DUE_SOON" | "EXPIRED";
export type ServiceStatus = "UNKNOWN" | "OK" | "DUE_SOON" | "OVERDUE";

const DUE_SOON_DAYS = 30;
const DUE_SOON_KM = 1000;

/** RG-M02-12 — statut de visite technique : À jour (> 30 j) / Bientôt (≤ 30 j) / Expirée (< aujourd'hui) / Inconnue. */
export function computeInspectionStatus(input: {
  expiryDate: Date | null | undefined;
  today: Date;
}): InspectionStatus {
  if (!input.expiryDate) {
    return "UNKNOWN";
  }
  const daysUntil = differenceInCalendarDays(input.expiryDate, input.today);
  if (daysUntil < 0) {
    return "EXPIRED";
  }
  if (daysUntil <= DUE_SOON_DAYS) {
    return "DUE_SOON";
  }
  return "OK";
}

/** Section 5 — statut de révision : OK / Bientôt (≤ 30 j ou ≤ 1 000 km) / Dépassée / Inconnue. */
export function computeServiceStatus(input: {
  nextServiceDueDate: Date | null | undefined;
  nextServiceDueMileage: number | null | undefined;
  currentMileage: number | null | undefined;
  today: Date;
}): ServiceStatus {
  const { nextServiceDueDate, nextServiceDueMileage, currentMileage, today } = input;

  if (nextServiceDueDate == null && nextServiceDueMileage == null) {
    return "UNKNOWN";
  }

  const daysUntil =
    nextServiceDueDate != null ? differenceInCalendarDays(nextServiceDueDate, today) : null;
  const kmRemaining =
    nextServiceDueMileage != null && currentMileage != null
      ? nextServiceDueMileage - currentMileage
      : null;

  if ((daysUntil != null && daysUntil < 0) || (kmRemaining != null && kmRemaining <= 0)) {
    return "OVERDUE";
  }
  if (
    (daysUntil != null && daysUntil <= DUE_SOON_DAYS) ||
    (kmRemaining != null && kmRemaining <= DUE_SOON_KM)
  ) {
    return "DUE_SOON";
  }
  return "OK";
}
