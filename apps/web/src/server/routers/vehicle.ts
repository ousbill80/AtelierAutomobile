import { TRPCError } from "@trpc/server";
import {
  computeAvgKmPerDay,
  computeNextServiceDue,
  estimateMileage,
  inspectionStatus,
  isDomainError,
  normalizePlate,
  serviceStatus,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  bulkCreateVehiclesInputSchema,
  deleteVehicleInputSchema,
  mergeVehicleInputSchema,
  recordInspectionInputSchema,
  recordMileageInputSchema,
  recordServiceInputSchema,
  replacePlateInputSchema,
  setVehicleInsuranceInputSchema,
  transferOwnerInputSchema,
  updateVehicleInputSchema,
  vehicleGetInputSchema,
  vehicleInputSchema,
  vehicleListInputSchema,
  type VehicleInput,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

const OPEN_REPAIR_ORDER_STATUSES = [
  "DRAFT",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_PARTS",
  "QUALITY_CHECK",
  "READY",
] as const;

function normalizePlateOrThrow(plate: string) {
  try {
    return normalizePlate(plate);
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

function vehicleCreateData(organizationId: string, input: Omit<VehicleInput, "customerId">) {
  const normalized = normalizePlateOrThrow(input.plate);
  return {
    organizationId,
    plate: normalized.plate,
    plateCompact: normalized.plateCompact,
    plateType: input.plateType ?? normalized.plateType,
    usage: input.usage ?? "PRIVATE",
    vin: input.vin?.toUpperCase(),
    make: input.make,
    model: input.model,
    makeId: input.makeId,
    modelId: input.modelId,
    version: input.version,
    year: input.year,
    firstRegistrationDate: input.firstRegistrationDate,
    fuel: input.fuel,
    transmission: input.transmission,
    engineCode: input.engineCode,
    color: input.color,
    fleetNumber: input.fleetNumber,
    driverName: input.driverName,
    driverPhone: input.driverPhone,
    serviceIntervalKm: input.serviceIntervalKm,
    serviceIntervalMonths: input.serviceIntervalMonths,
    odometerInMiles: input.odometerInMiles ?? false,
  };
}

async function computeVehicleStatus(vehicle: {
  currentMileage: number | null;
  currentMileageAt: Date | null;
  avgKmPerDay: number | null;
  estimatedMileage: number | null;
  odometerOffset: number;
  inspectionExpiryDate: Date | null;
  nextServiceDueDate: Date | null;
  nextServiceDueMileage: number | null;
}) {
  const today = new Date();
  const estimated =
    vehicle.currentMileage != null &&
    vehicle.currentMileageAt != null &&
    vehicle.avgKmPerDay != null
      ? estimateMileage(
          vehicle.currentMileage,
          vehicle.avgKmPerDay,
          vehicle.currentMileageAt,
          today,
          vehicle.odometerOffset,
        )
      : vehicle.estimatedMileage;

  return {
    inspection: inspectionStatus(vehicle.inspectionExpiryDate, today),
    service: serviceStatus(
      vehicle.nextServiceDueDate,
      vehicle.nextServiceDueMileage,
      estimated,
      today,
    ),
    estimatedMileage: estimated,
  };
}

export const vehicleRouter = router({
  list: requirePermission("vehicle:read")
    .input(vehicleListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const where: Record<string, unknown> = { deletedAt: null };
      if (input.customerId) where.customerId = input.customerId;
      if (input.make) where.make = input.make;
      if (input.usage) where.usage = input.usage;
      if (input.plateType) where.plateType = input.plateType;
      if (input.q) {
        const compact = input.q.toUpperCase().replace(/[^A-Z0-9]/g, "");
        where.OR = [
          { plateCompact: { contains: compact } },
          { vin: { contains: input.q.toUpperCase() } },
          { fleetNumber: { contains: input.q, mode: "insensitive" } },
        ];
      }

      const items = await tenantDb.vehicle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const nextCursor = items.length > input.limit ? items[input.limit]!.id : null;

      const filtered = await Promise.all(
        items.slice(0, input.limit).map(async (vehicle) => ({
          ...vehicle,
          status: await computeVehicleStatus(vehicle),
        })),
      );
      const statusFiltered = filtered.filter(
        (v) =>
          (!input.inspectionStatus || v.status.inspection === input.inspectionStatus) &&
          (!input.serviceStatus || v.status.service === input.serviceStatus),
      );

      return { items: statusFiltered, nextCursor };
    }),

  get: requirePermission("vehicle:read")
    .input(vehicleGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
        include: {
          mileageReadings: { orderBy: { readAt: "desc" }, take: 10 },
          customer: { select: { id: true, displayName: true } },
          insuranceCompany: { select: { id: true, name: true } },
        },
      });
      return { ...vehicle, status: await computeVehicleStatus(vehicle) };
    }),

  create: requirePermission("vehicle:create")
    .input(vehicleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const normalized = normalizePlateOrThrow(input.plate);

      const existing = await tenantDb.vehicle.findFirst({
        where: {
          plateCompact: normalized.plateCompact,
          deletedAt: null,
          plateType: { not: "NONE" },
        },
        include: { customer: { select: { displayName: true } } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ce véhicule existe déjà, propriétaire : ${existing.customer.displayName}.`,
        });
      }

      const vehicle = await tenantDb.vehicle.create({
        data: { ...vehicleCreateData(ctx.organizationId, input), customerId: input.customerId },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.created",
        entity: "Vehicle",
        entityId: vehicle.id,
        after: vehicle,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return vehicle;
    }),

  bulkCreate: requirePermission("vehicle:create")
    .input(bulkCreateVehiclesInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const created: unknown[] = [];
      const errors: { row: number; message: string }[] = [];

      for (const [index, vehicleInput] of input.vehicles.entries()) {
        try {
          const normalized = normalizePlateOrThrow(vehicleInput.plate);
          const existing = await tenantDb.vehicle.findFirst({
            where: {
              plateCompact: normalized.plateCompact,
              deletedAt: null,
              plateType: { not: "NONE" },
            },
          });
          if (existing) {
            errors.push({ row: index, message: `Plaque ${normalized.plate} déjà existante.` });
            continue;
          }
          const vehicle = await tenantDb.vehicle.create({
            data: {
              ...vehicleCreateData(ctx.organizationId, vehicleInput),
              customerId: input.customerId,
            },
          });
          created.push(vehicle);
        } catch (error) {
          errors.push({
            row: index,
            message: error instanceof Error ? error.message : "Erreur inconnue",
          });
        }
      }

      return { created: created.length, errors };
    }),

  update: requirePermission("vehicle:update")
    .input(updateVehicleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.id } });

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.id },
        data: {
          vin: input.patch.vin?.toUpperCase(),
          make: input.patch.make,
          model: input.patch.model,
          makeId: input.patch.makeId,
          modelId: input.patch.modelId,
          version: input.patch.version,
          year: input.patch.year,
          fuel: input.patch.fuel,
          transmission: input.patch.transmission,
          engineCode: input.patch.engineCode,
          color: input.patch.color,
          fleetNumber: input.patch.fleetNumber,
          driverName: input.patch.driverName,
          driverPhone: input.patch.driverPhone,
          usage: input.patch.usage,
          serviceIntervalKm: input.patch.serviceIntervalKm,
          serviceIntervalMonths: input.patch.serviceIntervalMonths,
          odometerInMiles: input.patch.odometerInMiles,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.updated",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: vehicle,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return vehicle;
    }),

  /**
   * M16 — rattache le véhicule à une compagnie (de l'organisation, active) et à une police ;
   * repris à l'ouverture d'un dossier sinistre (US-M16-01). Audité.
   */
  setInsurance: requirePermission("vehicle:update")
    .input(setVehicleInsuranceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.vehicle.findFirst({
        where: { id: input.vehicleId, deletedAt: null },
      });
      if (!before) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Véhicule introuvable." });
      }
      if (input.insuranceCompanyId) {
        const insurer = await tenantDb.insuranceCompany.findFirst({
          where: { id: input.insuranceCompanyId, isActive: true },
          select: { id: true },
        });
        if (!insurer) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Compagnie d'assurance introuvable ou désactivée.",
          });
        }
      }
      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          insuranceCompanyId: input.insuranceCompanyId,
          insurancePolicyNumber: input.policyNumber || null,
          insuranceExpiryDate: input.expiryDate
            ? new Date(`${input.expiryDate}T00:00:00.000Z`)
            : null,
        },
        include: { insuranceCompany: { select: { id: true, name: true } } },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.insurance_updated",
        entity: "Vehicle",
        entityId: vehicle.id,
        before: {
          insuranceCompanyId: before.insuranceCompanyId,
          insurancePolicyNumber: before.insurancePolicyNumber,
          insuranceExpiryDate: before.insuranceExpiryDate,
        },
        after: {
          insuranceCompanyId: vehicle.insuranceCompanyId,
          insurancePolicyNumber: vehicle.insurancePolicyNumber,
          insuranceExpiryDate: vehicle.insuranceExpiryDate,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return vehicle;
    }),

  recordMileage: requirePermission("vehicle:update")
    .input(recordMileageInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });

      const warnings: string[] = [];
      let odometerOffset = vehicle.odometerOffset;

      if (
        vehicle.currentMileage != null &&
        input.mileage < vehicle.currentMileage &&
        !input.odometerReset
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Kilométrage inférieur au dernier relevé (${vehicle.currentMileage} km). Vérifiez la saisie.`,
        });
      }
      if (
        vehicle.currentMileage != null &&
        input.mileage < vehicle.currentMileage &&
        input.odometerReset
      ) {
        odometerOffset += vehicle.currentMileage - input.mileage;
        await tenantDb.vehicleEvent.create({
          data: {
            organizationId: ctx.organizationId,
            vehicleId: vehicle.id,
            type: "odometer_replaced",
            occurredAt: input.readAt,
            data: { oldMileage: vehicle.currentMileage, newStartMileage: input.mileage },
            createdById: ctx.membership.id,
          },
        });
      }

      if (vehicle.currentMileage != null && vehicle.currentMileageAt) {
        const days = Math.max(
          1,
          (input.readAt.getTime() - vehicle.currentMileageAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        const impliedRate = (input.mileage - vehicle.currentMileage) / days;
        if (impliedRate > 1000 && !input.confirmHighRate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${Math.round(input.mileage - vehicle.currentMileage)} km en ${Math.round(days)} j : saisie correcte ?`,
          });
        }
      }

      await tenantDb.mileageReading.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: vehicle.id,
          mileage: input.mileage,
          readAt: input.readAt,
          source: input.source,
          createdById: ctx.membership.id,
        },
      });

      const isNewLatest = !vehicle.currentMileageAt || input.readAt >= vehicle.currentMileageAt;
      let updated = vehicle;
      if (isNewLatest && input.source !== "IMPORT") {
        const readings = await tenantDb.mileageReading.findMany({
          where: { vehicleId: vehicle.id },
        });
        const { avgKmPerDay } = computeAvgKmPerDay(readings, vehicle.usage, new Date());
        const serviceDue = computeNextServiceDue({
          lastServiceDate: vehicle.lastServiceDate,
          lastServiceMileage: vehicle.lastServiceMileage,
          serviceIntervalKm: vehicle.serviceIntervalKm,
          serviceIntervalMonths: vehicle.serviceIntervalMonths,
          currentMileage: input.mileage,
          currentMileageAt: input.readAt,
          avgKmPerDay,
          today: new Date(),
        });

        updated = await tenantDb.vehicle.update({
          where: { id: vehicle.id },
          data: {
            currentMileage: input.mileage,
            currentMileageAt: input.readAt,
            avgKmPerDay,
            odometerOffset,
            estimatedMileage: input.mileage + odometerOffset,
            nextServiceDueDate: serviceDue.nextServiceDueDate,
            nextServiceDueMileage: serviceDue.nextServiceDueMileage,
            nextServiceTrigger: serviceDue.trigger,
          },
        });
      }

      return { vehicle: updated, warnings };
    }),

  recordInspection: requirePermission("vehicle:update")
    .input(recordInspectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      if (input.expiryDate && input.expiryDate <= input.date) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La date d'expiration doit être après la date de la visite.",
        });
      }
      const expiry = input.expiryDate ?? new Date(input.date.getTime() + 365 * 24 * 60 * 60 * 1000);

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          inspectionLastDate: input.date,
          inspectionExpiryDate: expiry,
          inspectionCenter: input.center,
        },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: vehicle.id,
          type: "inspection_done",
          occurredAt: input.date,
          data: { expiryDate: expiry.toISOString(), center: input.center ?? null },
          createdById: ctx.membership.id,
        },
      });

      return vehicle;
    }),

  recordService: requirePermission("vehicle:update")
    .input(recordServiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });

      const readings = await tenantDb.mileageReading.findMany({ where: { vehicleId: vehicle.id } });
      const { avgKmPerDay } = computeAvgKmPerDay(readings, vehicle.usage, new Date());
      const serviceDue = computeNextServiceDue({
        lastServiceDate: input.date,
        lastServiceMileage: input.mileage,
        serviceIntervalKm: vehicle.serviceIntervalKm,
        serviceIntervalMonths: vehicle.serviceIntervalMonths,
        currentMileage: vehicle.currentMileage,
        currentMileageAt: vehicle.currentMileageAt,
        avgKmPerDay,
        today: new Date(),
      });

      const updated = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          lastServiceDate: input.date,
          lastServiceMileage: input.mileage,
          nextServiceDueDate: serviceDue.nextServiceDueDate,
          nextServiceDueMileage: serviceDue.nextServiceDueMileage,
          nextServiceTrigger: serviceDue.trigger,
        },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: vehicle.id,
          type: "service_done",
          occurredAt: input.date,
          data: { mileage: input.mileage, repairOrderId: input.repairOrderId ?? null },
          createdById: ctx.membership.id,
        },
      });

      return updated;
    }),

  transferOwner: requirePermission("vehicle:transfer")
    .input(transferOwnerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });

      const openCount = await tenantDb.repairOrder.count({
        where: { vehicleId: vehicle.id, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openCount > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Un OR est en cours. Terminez-le avant de changer de propriétaire.",
        });
      }

      const fromCustomerId = vehicle.customerId;
      const updated = await tenantDb.vehicle.update({
        where: { id: vehicle.id },
        data: { customerId: input.toCustomerId },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: vehicle.id,
          type: "owner_changed",
          occurredAt: input.effectiveDate,
          data: { fromCustomerId, toCustomerId: input.toCustomerId, note: input.note ?? null },
          createdById: ctx.membership.id,
        },
      });

      await tenantDb.reminder.updateMany({
        where: {
          vehicleId: vehicle.id,
          customerId: fromCustomerId,
          status: { in: ["PLANNED", "NEEDS_APPROVAL"] },
        },
        data: { status: "CANCELLED", skippedReason: "Changement de propriétaire" },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.owner_changed",
        entity: "Vehicle",
        entityId: vehicle.id,
        before: vehicle,
        after: updated,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return updated;
    }),

  replacePlate: requirePermission("vehicle:transfer")
    .input(replacePlateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.vehicleId } });
      const normalized = normalizePlateOrThrow(input.newPlate);

      const updated = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          plate: normalized.plate,
          plateCompact: normalized.plateCompact,
          plateType: input.plateType,
        },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: vehicle.id,
          type: "plate_changed",
          occurredAt: new Date(),
          data: { oldPlate: vehicle.plate, newPlate: normalized.plate },
          createdById: ctx.membership.id,
        },
      });

      return updated;
    }),

  merge: requirePermission("customer:merge")
    .input(mergeVehicleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.transaction(async (tx) => {
        const source = await tx.vehicle.findFirstOrThrow({ where: { id: input.sourceId } });
        await tx.vehicle.findFirstOrThrow({ where: { id: input.targetId } });

        const movedCounts: Record<string, number> = {};
        for (const model of [
          "mileageReading",
          "vehicleEvent",
          "appointment",
          "repairOrder",
          "quote",
          "invoice",
          "reminder",
        ] as const) {
          const updateMany = tx[model].updateMany as unknown as (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>;
          const res = await updateMany({
            where: { vehicleId: source.id },
            data: { vehicleId: input.targetId },
          });
          movedCounts[model] = res.count;
        }

        await tx.vehicle.update({
          where: { id: source.id },
          data: { deletedAt: new Date(), mergedIntoId: input.targetId },
        });

        return { moved: movedCounts, source };
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.merge",
        entity: "Vehicle",
        entityId: input.targetId,
        before: result.source,
        reason: `Fusion du véhicule ${result.source.plate} dans ${input.targetId}`,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { moved: result.moved };
    }),

  delete: requirePermission("vehicle:delete")
    .input(deleteVehicleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({ where: { id: input.id } });

      const openCount = await tenantDb.repairOrder.count({
        where: { vehicleId: input.id, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openCount > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Ce véhicule a un OR en cours." });
      }

      await tenantDb.vehicle.update({ where: { id: input.id }, data: { deletedAt: new Date() } });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.deleted",
        entity: "Vehicle",
        entityId: vehicle.id,
        before: vehicle,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),
});
