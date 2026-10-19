import { TRPCError } from "@trpc/server";
import {
  computeAvgKmPerDay,
  computeEstimatedMileage,
  computeInspectionStatus,
  computeNextServiceDue,
  computeServiceStatus,
  normalizePlate,
  type VehicleUsage,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  recordInspectionInputSchema,
  recordMileageInputSchema,
  recordServiceInputSchema,
  replacePlateInputSchema,
  transferOwnerInputSchema,
  vehicleBulkCreateInputSchema,
  vehicleCreateInputSchema,
  vehicleDeleteInputSchema,
  vehicleGetInputSchema,
  vehicleListInputSchema,
  vehicleMergeInputSchema,
  vehicleUpdateInputSchema,
  type VehicleInput,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { toTRPCError } from "../domain-error";

/** Durée de validité par défaut de la VT selon l'usage (RG-M02-12), en mois. Paramétrable par M15. */
const INSPECTION_VALIDITY_MONTHS: Record<VehicleUsage, number> = {
  PRIVATE: 12,
  TAXI: 6,
  TRANSPORT: 6,
  UTILITY: 12,
  RENTAL: 12,
  OTHER: 12,
};

export const OPEN_REPAIR_ORDER_STATUSES = [
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

function addMonthsUTC(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
}

function formatDateFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC" }).format(date);
}

type VehicleRow = Awaited<ReturnType<typeof findVehicleOrThrow>>;

async function findVehicleOrThrow(
  tenantDb: ReturnType<typeof db.forTenant>,
  id: string,
): Promise<{
  id: string;
  organizationId: string;
  customerId: string;
  plate: string;
  plateCompact: string;
  plateType: string;
  usage: string;
  make: string;
  model: string;
  makeId: string | null;
  modelId: string | null;
  firstRegistrationDate: Date | null;
  currentMileage: number | null;
  currentMileageAt: Date | null;
  odometerOffset: number;
  avgKmPerDay: number | null;
  inspectionExpiryDate: Date | null;
  serviceIntervalKm: number | null;
  serviceIntervalMonths: number | null;
  lastServiceDate: Date | null;
  lastServiceMileage: number | null;
  nextServiceDueDate: Date | null;
  nextServiceDueMileage: number | null;
}> {
  return tenantDb.vehicle.findFirstOrThrow({ where: { id, deletedAt: null } });
}

/** Recalcule `avgKmPerDay`, `estimatedMileage` et `nextServiceDue*` à partir des relevés connus. */
async function recomputeDerivedFields(
  tenantDb: ReturnType<typeof db.forTenant>,
  vehicle: VehicleRow,
  now: Date,
) {
  const readings = await tenantDb.mileageReading.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: { readAt: "asc" },
  });

  const avg = computeAvgKmPerDay({
    readings: readings.map((r) => ({
      mileage: r.mileage,
      readAt: r.readAt,
      isOutlier: r.isOutlier,
    })),
    usage: vehicle.usage as VehicleUsage,
    now,
    firstRegistrationDate: vehicle.firstRegistrationDate,
  });

  const estimatedMileage =
    vehicle.currentMileage != null && vehicle.currentMileageAt != null && avg.avgKmPerDay != null
      ? computeEstimatedMileage({
          currentMileage: vehicle.currentMileage,
          currentMileageAt: vehicle.currentMileageAt,
          avgKmPerDay: avg.avgKmPerDay,
          at: now,
        })
      : vehicle.currentMileage;

  const nextServiceDue = computeNextServiceDue({
    lastServiceDate: vehicle.lastServiceDate,
    lastServiceMileage: vehicle.lastServiceMileage,
    serviceIntervalKm: vehicle.serviceIntervalKm,
    serviceIntervalMonths: vehicle.serviceIntervalMonths,
    currentMileage: vehicle.currentMileage,
    currentMileageAt: vehicle.currentMileageAt,
    avgKmPerDay: avg.avgKmPerDay,
    today: now,
  });

  return tenantDb.vehicle.update({
    where: { id: vehicle.id },
    data: {
      avgKmPerDay: avg.avgKmPerDay,
      estimatedMileage,
      nextServiceDueDate: nextServiceDue.nextServiceDueDate,
      nextServiceDueMileage: nextServiceDue.nextServiceDueMileage,
      nextServiceTrigger: nextServiceDue.trigger,
    },
  });
}

export function withStatuses<T extends VehicleRow>(vehicle: T, now: Date) {
  return {
    ...vehicle,
    inspectionStatus: computeInspectionStatus({
      expiryDate: vehicle.inspectionExpiryDate,
      today: now,
    }),
    serviceStatus: computeServiceStatus({
      nextServiceDueDate: vehicle.nextServiceDueDate,
      nextServiceDueMileage: vehicle.nextServiceDueMileage,
      currentMileage: vehicle.currentMileage,
      today: now,
    }),
  };
}

/** Applique les valeurs par défaut du catalogue (intervalle de révision) si `modelId` est fourni. */
export async function applyCatalogDefaults(input: VehicleInput): Promise<VehicleInput> {
  if (!input.modelId || (input.serviceIntervalKm != null && input.serviceIntervalMonths != null)) {
    return input;
  }
  const model = await adminDb.vehicleModel.findUnique({ where: { id: input.modelId } });
  if (!model) return input;
  return {
    ...input,
    serviceIntervalKm: input.serviceIntervalKm ?? model.serviceIntervalKm ?? null,
    serviceIntervalMonths: input.serviceIntervalMonths ?? model.serviceIntervalMonths ?? null,
    fuel: input.fuel ?? model.defaultFuel ?? null,
  };
}

export async function assertPlateAvailable(
  tenantDb: ReturnType<typeof db.forTenant>,
  plateCompact: string,
  plateType: string,
  excludeId?: string,
) {
  if (plateType === "NONE" || plateCompact === "") return;
  const existing = await tenantDb.vehicle.findFirst({
    where: {
      plateCompact,
      deletedAt: null,
      plateType: { not: "NONE" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    include: { customer: { select: { displayName: true } } },
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ce véhicule existe déjà, propriétaire : ${existing.customer.displayName}.`,
      cause: {
        code: "PLATE_EXISTS",
        vehicleId: existing.id,
        ownerName: existing.customer.displayName,
      },
    });
  }
}

export const vehicleRouter = router({
  list: requirePermission("vehicle:read")
    .input(vehicleListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const dueSoonLimit = addMonthsUTC(now, 0);
      dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 30);

      const where: Record<string, unknown> = { deletedAt: null };
      if (input.customerId) where.customerId = input.customerId;
      if (input.make) where.make = { equals: input.make, mode: "insensitive" };
      if (input.usage) where.usage = input.usage;
      if (input.plateType) where.plateType = input.plateType;
      if (input.q) {
        const compact = input.q.toUpperCase().replace(/[^A-Z0-9]/g, "");
        where.OR = [
          { plateCompact: { contains: compact } },
          { vin: { contains: input.q.toUpperCase() } },
          { make: { contains: input.q, mode: "insensitive" } },
          { model: { contains: input.q, mode: "insensitive" } },
          { fleetNumber: { contains: input.q, mode: "insensitive" } },
        ];
      }
      if (input.inspectionStatus) {
        where.inspectionExpiryDate =
          input.inspectionStatus === "UNKNOWN"
            ? null
            : input.inspectionStatus === "EXPIRED"
              ? { lt: now }
              : input.inspectionStatus === "DUE_SOON"
                ? { gte: now, lte: dueSoonLimit }
                : { gt: dueSoonLimit };
      }
      if (input.serviceStatus) {
        where.nextServiceDueDate =
          input.serviceStatus === "UNKNOWN"
            ? null
            : input.serviceStatus === "OVERDUE"
              ? { lt: now }
              : input.serviceStatus === "DUE_SOON"
                ? { gte: now, lte: dueSoonLimit }
                : { gt: dueSoonLimit };
      }

      const rows = await tenantDb.vehicle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      const hasMore = rows.length > input.limit;
      const items = (hasMore ? rows.slice(0, input.limit) : rows).map((v) => withStatuses(v, now));
      return { items, nextCursor: hasMore ? rows[input.limit]!.id : null };
    }),

  get: requirePermission("vehicle:read")
    .input(vehicleGetInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await tenantDb.vehicle.findFirstOrThrow({
        where: { id: input.id, deletedAt: null },
        include: { customer: { select: { id: true, displayName: true, type: true } } },
      });
      const mileageReadings = await tenantDb.mileageReading.findMany({
        where: { vehicleId: input.id },
        orderBy: { readAt: "desc" },
        take: 10,
      });
      return { ...withStatuses(vehicle, new Date()), mileageReadings };
    }),

  create: requirePermission("vehicle:create")
    .input(vehicleCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.customer.findFirstOrThrow({
        where: { id: input.customerId, deletedAt: null },
      });

      const { customerId, ...vehicleInput } = input;
      const withDefaults = await applyCatalogDefaults(vehicleInput);

      let normalized: ReturnType<typeof normalizePlate>;
      try {
        normalized = normalizePlate(withDefaults.plate);
      } catch (error) {
        toTRPCError(error);
      }
      await assertPlateAvailable(tenantDb, normalized.plateCompact, normalized.plateType);

      const vehicle = await tenantDb.vehicle.create({
        data: {
          organizationId: ctx.organizationId,
          customerId,
          plate: normalized.plate,
          plateCompact: normalized.plateCompact,
          plateType: normalized.plateType,
          usage: withDefaults.usage,
          vin: withDefaults.vin ?? null,
          make: withDefaults.make,
          model: withDefaults.model,
          makeId: withDefaults.makeId ?? null,
          modelId: withDefaults.modelId ?? null,
          version: withDefaults.version ?? null,
          year: withDefaults.year ?? null,
          firstRegistrationDate: withDefaults.firstRegistrationDate ?? null,
          fuel: withDefaults.fuel ?? null,
          transmission: withDefaults.transmission ?? null,
          engineCode: withDefaults.engineCode ?? null,
          color: withDefaults.color ?? null,
          fleetNumber: withDefaults.fleetNumber ?? null,
          driverName: withDefaults.driverName ?? null,
          driverPhone: withDefaults.driverPhone ?? null,
          odometerInMiles: withDefaults.odometerInMiles,
          currentMileage: withDefaults.currentMileage ?? null,
          currentMileageAt: withDefaults.currentMileage != null ? new Date() : null,
          serviceIntervalKm: withDefaults.serviceIntervalKm ?? null,
          serviceIntervalMonths: withDefaults.serviceIntervalMonths ?? null,
          insuranceCompanyId: withDefaults.insuranceCompanyId ?? null,
          insuranceExpiryDate: withDefaults.insuranceExpiryDate ?? null,
          insurancePolicyNumber: withDefaults.insurancePolicyNumber ?? null,
          notes: withDefaults.notes ?? null,
        },
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

      return withStatuses(vehicle, new Date());
    }),

  bulkCreate: requirePermission("vehicle:create")
    .input(vehicleBulkCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await tenantDb.customer.findFirstOrThrow({
        where: { id: input.customerId, deletedAt: null },
      });

      const created: unknown[] = [];
      const errors: Array<{ row: number; message: string }> = [];

      for (let row = 0; row < input.vehicles.length; row++) {
        const vehicleInput = input.vehicles[row]!;
        try {
          const withDefaults = await applyCatalogDefaults(vehicleInput);
          const normalized = normalizePlate(withDefaults.plate);
          await assertPlateAvailable(tenantDb, normalized.plateCompact, normalized.plateType);

          const vehicle = await tenantDb.vehicle.create({
            data: {
              organizationId: ctx.organizationId,
              customerId: input.customerId,
              plate: normalized.plate,
              plateCompact: normalized.plateCompact,
              plateType: normalized.plateType,
              usage: withDefaults.usage,
              vin: withDefaults.vin ?? null,
              make: withDefaults.make,
              model: withDefaults.model,
              makeId: withDefaults.makeId ?? null,
              modelId: withDefaults.modelId ?? null,
              year: withDefaults.year ?? null,
              fuel: withDefaults.fuel ?? null,
              fleetNumber: withDefaults.fleetNumber ?? null,
              driverName: withDefaults.driverName ?? null,
              driverPhone: withDefaults.driverPhone ?? null,
              serviceIntervalKm: withDefaults.serviceIntervalKm ?? null,
              serviceIntervalMonths: withDefaults.serviceIntervalMonths ?? null,
              currentMileage: withDefaults.currentMileage ?? null,
              currentMileageAt: withDefaults.currentMileage != null ? new Date() : null,
            },
          });
          created.push(vehicle);
        } catch (error) {
          const message = error instanceof TRPCError ? error.message : (error as Error).message;
          errors.push({ row, message });
        }
      }

      if (created.length > 0) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "vehicle.bulk_created",
          entity: "Vehicle",
          entityId: input.customerId,
          after: { count: created.length },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      return { created, errors };
    }),

  update: requirePermission("vehicle:update")
    .input(vehicleUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.id);

      let plateFields = {};
      if (input.patch.plate) {
        let normalized: ReturnType<typeof normalizePlate>;
        try {
          normalized = normalizePlate(input.patch.plate);
        } catch (error) {
          toTRPCError(error);
        }
        await assertPlateAvailable(
          tenantDb,
          normalized.plateCompact,
          normalized.plateType,
          input.id,
        );
        plateFields = {
          plate: normalized.plate,
          plateCompact: normalized.plateCompact,
          plateType: normalized.plateType,
        };
      }

      // `plateFields` (calculé ci-dessus depuis `normalizePlate`) est repris en dernier pour
      // remplacer le `plate` brut de `input.patch` par sa forme normalisée.
      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.id },
        data: { ...input.patch, ...plateFields },
      });

      const intervalsChanged =
        input.patch.serviceIntervalKm !== undefined ||
        input.patch.serviceIntervalMonths !== undefined;
      const final = intervalsChanged
        ? await recomputeDerivedFields(tenantDb, vehicle, new Date())
        : vehicle;

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.updated",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: final,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return withStatuses(final, new Date());
    }),

  recordMileage: requirePermission("vehicle:update")
    .input(recordMileageInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const vehicle = await findVehicleOrThrow(tenantDb, input.vehicleId);
      const warnings: string[] = [];

      // RG-M02-09 §3 : un relevé IMPORT antérieur au dernier relevé connu est stocké
      // sans remplacer currentMileage (donnée historique, pas un nouveau relevé courant).
      if (
        input.source === "IMPORT" &&
        vehicle.currentMileageAt &&
        input.readAt < vehicle.currentMileageAt
      ) {
        const lifeMileage = input.mileage + vehicle.odometerOffset;
        await tenantDb.mileageReading.create({
          data: {
            organizationId: ctx.organizationId,
            vehicleId: input.vehicleId,
            mileage: lifeMileage,
            readAt: input.readAt,
            source: input.source,
            repairOrderId: input.repairOrderId,
            createdById: ctx.membership.id,
          },
        });
        return { vehicle: withStatuses(vehicle, new Date()), warnings };
      }

      const lifeMileage = input.mileage + vehicle.odometerOffset;
      let newOdometerOffset = vehicle.odometerOffset;

      if (vehicle.currentMileage != null && lifeMileage < vehicle.currentMileage) {
        if (!input.odometerReset) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Kilométrage inférieur au dernier relevé (${vehicle.currentMileage.toLocaleString("fr-FR")} km le ${formatDateFr(vehicle.currentMileageAt ?? new Date())}). Vérifiez la saisie.`,
          });
        }
        if (!ctx.permissions.has("vehicle:mileage_correct")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Permission manquante : vehicle:mileage_correct",
          });
        }
        newOdometerOffset = vehicle.currentMileage - input.mileage;
        await tenantDb.vehicleEvent.create({
          data: {
            organizationId: ctx.organizationId,
            vehicleId: input.vehicleId,
            type: "odometer_replaced",
            occurredAt: input.readAt,
            data: { oldMileage: vehicle.currentMileage, newStartMileage: input.mileage },
            createdById: ctx.membership.id,
          },
        });
      } else if (
        vehicle.currentMileage != null &&
        vehicle.currentMileageAt &&
        !input.confirmHighRate
      ) {
        const deltaKm = lifeMileage - vehicle.currentMileage;
        const deltaDays = daysBetween(vehicle.currentMileageAt, input.readAt);
        if (deltaDays > 0 && deltaKm / deltaDays > 1000) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `${Math.round(deltaKm).toLocaleString("fr-FR")} km en ${Math.ceil(deltaDays)} j : saisie correcte ?`,
          });
        }
      }

      const finalLifeMileage =
        vehicle.currentMileage != null &&
        lifeMileage < vehicle.currentMileage &&
        input.odometerReset
          ? vehicle.currentMileage
          : lifeMileage;

      await tenantDb.mileageReading.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          mileage: finalLifeMileage,
          readAt: input.readAt,
          source: input.source,
          repairOrderId: input.repairOrderId,
          createdById: ctx.membership.id,
        },
      });

      const updated = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          currentMileage: finalLifeMileage,
          currentMileageAt: input.readAt,
          odometerOffset: newOdometerOffset,
        },
      });

      const final = await recomputeDerivedFields(tenantDb, updated, new Date());

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.mileage_recorded",
        entity: "Vehicle",
        entityId: input.vehicleId,
        before: { currentMileage: vehicle.currentMileage },
        after: { currentMileage: final.currentMileage },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { vehicle: withStatuses(final, new Date()), warnings };
    }),

  recordInspection: requirePermission("vehicle:update")
    .input(recordInspectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.vehicleId);

      const expiryDate =
        input.expiryDate ??
        addMonthsUTC(input.date, INSPECTION_VALIDITY_MONTHS[before.usage as VehicleUsage]);

      if (expiryDate.getTime() <= input.date.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La date d'expiration doit être après la date de la visite.",
        });
      }

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          inspectionLastDate: input.date,
          inspectionExpiryDate: expiryDate,
          inspectionCenter: input.center ?? undefined,
        },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          type: "inspection_done",
          occurredAt: input.date,
          data: { expiryDate, center: input.center ?? null },
          createdById: ctx.membership.id,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.inspection_updated",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: vehicle,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return withStatuses(vehicle, new Date());
    }),

  recordService: requirePermission("vehicle:update")
    .input(recordServiceInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.vehicleId);

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: { lastServiceDate: input.date, lastServiceMileage: input.mileage },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          type: "service_done",
          occurredAt: input.date,
          data: { mileage: input.mileage, repairOrderId: input.repairOrderId ?? null },
          createdById: ctx.membership.id,
        },
      });

      const final = await recomputeDerivedFields(tenantDb, vehicle, new Date());

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.service_recorded",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: final,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return withStatuses(final, new Date());
    }),

  transferOwner: requirePermission("vehicle:transfer")
    .input(transferOwnerInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.vehicleId);
      await tenantDb.customer.findFirstOrThrow({
        where: { id: input.toCustomerId, deletedAt: null },
      });

      const openOrder = await tenantDb.repairOrder.findFirst({
        where: { vehicleId: input.vehicleId, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openOrder) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Un OR est en cours (${openOrder.number}). Terminez-le avant de changer de propriétaire.`,
        });
      }

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: { customerId: input.toCustomerId },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          type: "owner_changed",
          occurredAt: input.effectiveDate,
          data: {
            fromCustomerId: before.customerId,
            toCustomerId: input.toCustomerId,
            note: input.note ?? null,
          },
          createdById: ctx.membership.id,
        },
      });

      // RG US-M02-11 : les relances planifiées pour ce véhicule au nom de l'ancien
      // propriétaire sont annulées ; leur replanification pour le nouveau propriétaire
      // relève de l'algorithme de relances (M10, non livré à ce stade).
      await tenantDb.reminder.updateMany({
        where: { vehicleId: input.vehicleId, status: { in: ["PLANNED", "NEEDS_APPROVAL"] } },
        data: { status: "CANCELLED", skippedReason: "Changement de propriétaire" },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.owner_changed",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: vehicle,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return withStatuses(vehicle, new Date());
    }),

  replacePlate: requirePermission("vehicle:transfer")
    .input(replacePlateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.vehicleId);

      let normalized: ReturnType<typeof normalizePlate>;
      try {
        normalized = normalizePlate(input.newPlate);
      } catch (error) {
        toTRPCError(error);
      }
      await assertPlateAvailable(
        tenantDb,
        normalized.plateCompact,
        input.plateType ?? normalized.plateType,
        input.vehicleId,
      );

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.vehicleId },
        data: {
          plate: normalized.plate,
          plateCompact: normalized.plateCompact,
          plateType: input.plateType ?? normalized.plateType,
        },
      });

      await tenantDb.vehicleEvent.create({
        data: {
          organizationId: ctx.organizationId,
          vehicleId: input.vehicleId,
          type: "plate_changed",
          occurredAt: new Date(),
          data: { oldPlate: before.plate, newPlate: vehicle.plate },
          createdById: ctx.membership.id,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.plate_replaced",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: vehicle,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return withStatuses(vehicle, new Date());
    }),

  // RG-M02-08 §2 : la fusion de véhicules réutilise `customer:merge` (pas de permission dédiée).
  merge: requirePermission("customer:merge")
    .input(vehicleMergeInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.sourceId === input.targetId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Impossible de fusionner un véhicule avec lui-même.",
        });
      }
      const { organizationId } = ctx;

      // Le véhicule cible n'est pas réutilisé ensuite : la requête valide seulement son existence
      // (organisation, non supprimé) avant la fusion, via `findFirstOrThrow`.
      const [source] = await Promise.all([
        adminDb.vehicle.findFirstOrThrow({
          where: { id: input.sourceId, organizationId, deletedAt: null },
        }),
        adminDb.vehicle.findFirstOrThrow({
          where: { id: input.targetId, organizationId, deletedAt: null },
        }),
      ]);

      const moved = await adminDb.$transaction(async (tx) => {
        const counts: Record<string, number> = {};

        const reassign = async (
          model: {
            updateMany: (args: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) => Promise<{ count: number }>;
          },
          key: string,
        ) => {
          const result = await model.updateMany({
            where: { vehicleId: input.sourceId, organizationId },
            data: { vehicleId: input.targetId },
          });
          counts[key] = result.count;
        };

        await reassign(tx.mileageReading, "mileageReadings");
        await reassign(tx.vehicleEvent, "vehicleEvents");
        await reassign(tx.appointment, "appointments");
        await reassign(tx.repairOrder, "repairOrders");
        await reassign(tx.quote, "quotes");
        await reassign(tx.invoice, "invoices");
        await reassign(tx.reminder, "reminders");

        const attachments = await tx.attachment.updateMany({
          where: { entity: "vehicle", entityId: input.sourceId, organizationId },
          data: { entityId: input.targetId },
        });
        counts.attachments = attachments.count;

        await tx.vehicleEvent.create({
          data: {
            organizationId,
            vehicleId: input.targetId,
            type: "merged",
            occurredAt: new Date(),
            data: { sourceId: input.sourceId, snapshot: source },
            createdById: ctx.membership.id,
          },
        });

        await tx.vehicle.update({
          where: { id: input.sourceId },
          data: { deletedAt: new Date(), mergedIntoId: input.targetId },
        });

        return counts;
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.merge",
        entity: "Vehicle",
        entityId: input.targetId,
        before: source,
        after: { targetId: input.targetId, moved },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { targetId: input.targetId, moved };
    }),

  delete: requirePermission("vehicle:delete")
    .input(vehicleDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await findVehicleOrThrow(tenantDb, input.id);

      const openOrder = await tenantDb.repairOrder.findFirst({
        where: { vehicleId: input.id, status: { in: [...OPEN_REPAIR_ORDER_STATUSES] } },
      });
      if (openOrder) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Un OR est en cours (${openOrder.number}). Impossible de supprimer ce véhicule.`,
        });
      }
      const pendingQuote = await tenantDb.quote.findFirst({
        where: { vehicleId: input.id, status: { in: ["SENT", "VIEWED"] } },
      });
      if (pendingQuote) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Un devis (${pendingQuote.number}) est en attente de réponse pour ce véhicule.`,
        });
      }
      const unpaidInvoice = await tenantDb.invoice.findFirst({
        where: { vehicleId: input.id, balance: { gt: 0 }, status: { not: "VOID" } },
      });
      if (unpaidInvoice) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Une facture de ce véhicule a un solde impayé (${unpaidInvoice.balance.toLocaleString("fr-FR")} FCFA).`,
        });
      }

      const vehicle = await tenantDb.vehicle.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });

      await tenantDb.reminder.updateMany({
        where: { vehicleId: input.id, status: { in: ["PLANNED", "NEEDS_APPROVAL"] } },
        data: { status: "CANCELLED", skippedReason: "Véhicule supprimé" },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "vehicle.deleted",
        entity: "Vehicle",
        entityId: vehicle.id,
        before,
        after: vehicle,
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true };
    }),
});
