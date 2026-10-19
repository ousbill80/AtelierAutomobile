// RG-M02-13 — prochaine révision, premier critère atteint entre date et kilométrage.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ServiceDueInput {
  lastServiceDate?: Date | null;
  lastServiceMileage?: number | null;
  serviceIntervalKm?: number | null;
  serviceIntervalMonths?: number | null;
  currentMileage?: number | null;
  currentMileageAt?: Date | null;
  avgKmPerDay?: number | null;
  today: Date;
}

export type ServiceDueTrigger = "DATE" | "MILEAGE";

export interface ServiceDueResult {
  nextServiceDueDate: Date | null;
  nextServiceDueMileage: number | null;
  trigger: ServiceDueTrigger | null;
  overdue: boolean;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * RG-M02-13 — `dueByDate` et `dueMileage` sont calculés indépendamment selon les données
 * disponibles ; la date retenue est la plus proche des deux (`nextServiceDueDate`), le
 * déclencheur (`trigger`) indiquant lequel a produit le minimum. Si un seul critère est
 * connu, il fait foi seul ; si aucun n'est connu, le résultat est entièrement `null`.
 */
export function computeNextServiceDue(input: ServiceDueInput): ServiceDueResult {
  const {
    lastServiceDate,
    lastServiceMileage,
    serviceIntervalKm,
    serviceIntervalMonths,
    currentMileage,
    currentMileageAt,
    avgKmPerDay,
    today,
  } = input;

  const dueByDate =
    lastServiceDate && serviceIntervalMonths != null
      ? addMonths(lastServiceDate, serviceIntervalMonths)
      : null;

  const dueMileage =
    lastServiceMileage != null && serviceIntervalKm != null
      ? lastServiceMileage + serviceIntervalKm
      : null;

  let dateForKm: Date | null = null;
  if (
    dueMileage != null &&
    avgKmPerDay != null &&
    avgKmPerDay > 0 &&
    currentMileage != null &&
    currentMileageAt != null
  ) {
    const daysSinceReading = (today.getTime() - currentMileageAt.getTime()) / MS_PER_DAY;
    const estimatedToday = currentMileage + avgKmPerDay * daysSinceReading;
    if (dueMileage <= estimatedToday) {
      dateForKm = today;
    } else {
      const daysNeeded = Math.ceil((dueMileage - currentMileage) / avgKmPerDay);
      dateForKm = new Date(currentMileageAt.getTime() + daysNeeded * MS_PER_DAY);
    }
  }

  if (!dueByDate && !dateForKm) {
    return { nextServiceDueDate: null, nextServiceDueMileage: null, trigger: null, overdue: false };
  }

  let nextServiceDueDate: Date;
  let trigger: ServiceDueTrigger;
  if (dueByDate && dateForKm) {
    if (dateForKm.getTime() <= dueByDate.getTime()) {
      nextServiceDueDate = dateForKm;
      trigger = "MILEAGE";
    } else {
      nextServiceDueDate = dueByDate;
      trigger = "DATE";
    }
  } else if (dateForKm) {
    nextServiceDueDate = dateForKm;
    trigger = "MILEAGE";
  } else {
    nextServiceDueDate = dueByDate!;
    trigger = "DATE";
  }

  let nextServiceDueMileage: number | null;
  if (dueMileage != null) {
    nextServiceDueMileage = dueMileage;
  } else if (currentMileage != null && currentMileageAt != null && avgKmPerDay != null) {
    const days = (nextServiceDueDate.getTime() - currentMileageAt.getTime()) / MS_PER_DAY;
    nextServiceDueMileage = Math.round(currentMileage + avgKmPerDay * days);
  } else {
    nextServiceDueMileage = null;
  }

  return {
    nextServiceDueDate,
    nextServiceDueMileage,
    trigger,
    overdue: nextServiceDueDate.getTime() <= today.getTime(),
  };
}
