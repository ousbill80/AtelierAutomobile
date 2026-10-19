// RG-M10-08 — job quotidien (02:00) : kilométrage moyen, kilométrage estimé, prochaine
// échéance de révision. Réutilise les fonctions pures de M02 (`computeAvgKmPerDay`,
// `computeEstimatedMileage`) et M10 (`computeNextServiceDue`), sans dupliquer leur logique.
import { adminDb, db } from "@atelieros/db";
import {
  computeAvgKmPerDay,
  computeEstimatedMileage,
  computeNextServiceDue,
  type VehicleUsage,
} from "@atelieros/core";
import { DEFAULT_REMINDER_SETTINGS, reminderSettingsSchema } from "@atelieros/validators";
import { logger } from "../logger";

async function loadReminderSettings(organizationId: string) {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId } });
  const raw = (org?.settings as { reminders?: unknown } | null)?.reminders ?? {};
  return reminderSettingsSchema.catch(DEFAULT_REMINDER_SETTINGS).parse(raw);
}

export async function processVehiclesEstimateMileageJob(): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });

  for (const { id: organizationId } of organizations) {
    const settings = await loadReminderSettings(organizationId);
    const tenantDb = db.forTenant({ organizationId });
    const today = new Date();

    const vehicles = await tenantDb.vehicle.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        usage: true,
        firstRegistrationDate: true,
        currentMileage: true,
        currentMileageAt: true,
        lastServiceDate: true,
        lastServiceMileage: true,
        serviceIntervalKm: true,
        serviceIntervalMonths: true,
        fuel: true,
      },
    });

    for (const vehicle of vehicles) {
      try {
        const readings = await tenantDb.mileageReading.findMany({
          where: { vehicleId: vehicle.id },
          select: { mileage: true, readAt: true, isOutlier: true },
        });

        const { avgKmPerDay } = computeAvgKmPerDay({
          readings,
          usage: (vehicle.usage ?? "PRIVATE") as VehicleUsage,
          now: today,
          firstRegistrationDate: vehicle.firstRegistrationDate,
        });
        const effectiveAvgKmPerDay =
          avgKmPerDay != null && avgKmPerDay > 0 ? avgKmPerDay : settings.defaultKmPerDay;

        const estimatedMileage =
          vehicle.currentMileage != null && vehicle.currentMileageAt
            ? computeEstimatedMileage({
                currentMileage: vehicle.currentMileage,
                currentMileageAt: vehicle.currentMileageAt,
                avgKmPerDay: effectiveAvgKmPerDay,
                at: today,
              })
            : null;

        const serviceIntervalMonths =
          vehicle.serviceIntervalMonths ?? settings.serviceDefaults.months;
        const serviceIntervalKm = vehicle.serviceIntervalKm ?? settings.serviceDefaults.km;

        const due = computeNextServiceDue({
          lastServiceDate: vehicle.lastServiceDate,
          lastServiceMileage: vehicle.lastServiceMileage,
          serviceIntervalKm,
          serviceIntervalMonths,
          currentMileage: vehicle.currentMileage,
          currentMileageAt: vehicle.currentMileageAt,
          avgKmPerDay: effectiveAvgKmPerDay,
          today,
        });

        await tenantDb.vehicle.update({
          where: { id: vehicle.id },
          data: {
            avgKmPerDay: effectiveAvgKmPerDay,
            estimatedMileage,
            nextServiceDueDate: due.nextServiceDueDate,
            nextServiceDueMileage: due.nextServiceDueMileage,
            nextServiceTrigger: due.trigger,
            serviceDueBasis:
              due.trigger === "DATE" ? "date" : due.trigger === "MILEAGE" ? "km" : null,
          },
        });
      } catch (error) {
        logger.error(
          { vehicleId: vehicle.id, error: error instanceof Error ? error.message : error },
          "vehicles.estimate_mileage : échec sur un véhicule, passage au suivant",
        );
      }
    }
  }
}
