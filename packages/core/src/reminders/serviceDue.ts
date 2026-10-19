import { addDays, addMonths } from "date-fns";
import { computeEstimatedMileage } from "../vehicles/mileage";

export type ServiceDueTrigger = "DATE" | "MILEAGE";

export interface ComputeNextServiceDueInput {
  lastServiceDate?: Date | null;
  lastServiceMileage?: number | null;
  serviceIntervalKm?: number | null;
  serviceIntervalMonths?: number | null;
  currentMileage?: number | null;
  currentMileageAt?: Date | null;
  /** km/jour (cf. computeAvgKmPerDay) ; 0 ou absent désactive le critère kilométrique. */
  avgKmPerDay?: number | null;
  today: Date;
}

export interface NextServiceDueResult {
  nextServiceDueDate: Date | null;
  nextServiceDueMileage: number | null;
  trigger: ServiceDueTrigger | null;
}

/**
 * RG-M02-13 — prochaine révision, premier critère atteint entre date et kilométrage.
 * Si aucune des deux données n'est disponible, retourne des valeurs nulles
 * (« Révision : historique inconnu » côté interface).
 */
export function computeNextServiceDue(input: ComputeNextServiceDueInput): NextServiceDueResult {
  const dueByDate =
    input.lastServiceDate && input.serviceIntervalMonths != null
      ? addMonths(input.lastServiceDate, input.serviceIntervalMonths)
      : null;

  const dueMileage =
    input.lastServiceMileage != null && input.serviceIntervalKm != null
      ? input.lastServiceMileage + input.serviceIntervalKm
      : null;

  let dateForKm: Date | null = null;
  if (
    dueMileage != null &&
    input.avgKmPerDay != null &&
    input.avgKmPerDay > 0 &&
    input.currentMileage != null &&
    input.currentMileageAt != null
  ) {
    const estimatedToday = computeEstimatedMileage({
      currentMileage: input.currentMileage,
      currentMileageAt: input.currentMileageAt,
      avgKmPerDay: input.avgKmPerDay,
      at: input.today,
    });

    if (dueMileage <= estimatedToday) {
      dateForKm = input.today;
    } else {
      const days = Math.ceil((dueMileage - input.currentMileage) / input.avgKmPerDay);
      dateForKm = addDays(input.currentMileageAt, days);
    }
  }

  const candidates: Array<{ date: Date; trigger: ServiceDueTrigger }> = [];
  if (dueByDate) candidates.push({ date: dueByDate, trigger: "DATE" });
  if (dateForKm) candidates.push({ date: dateForKm, trigger: "MILEAGE" });

  if (candidates.length === 0) {
    return { nextServiceDueDate: null, nextServiceDueMileage: dueMileage, trigger: null };
  }

  candidates.sort((a, b) => a.date.getTime() - b.date.getTime());
  const winner = candidates[0]!;

  let nextServiceDueMileage = dueMileage;
  if (
    nextServiceDueMileage == null &&
    input.currentMileage != null &&
    input.currentMileageAt != null &&
    input.avgKmPerDay != null &&
    input.avgKmPerDay > 0
  ) {
    nextServiceDueMileage = Math.round(
      computeEstimatedMileage({
        currentMileage: input.currentMileage,
        currentMileageAt: input.currentMileageAt,
        avgKmPerDay: input.avgKmPerDay,
        at: winner.date,
      }),
    );
  }

  return {
    nextServiceDueDate: winner.date,
    nextServiceDueMileage: nextServiceDueMileage ?? null,
    trigger: winner.trigger,
  };
}
