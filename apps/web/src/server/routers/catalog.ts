import {
  addLocalModelInputSchema,
  catalogMakesInputSchema,
  catalogModelsInputSchema,
} from "@atelieros/validators";
import { adminDb } from "@atelieros/db";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

/**
 * Routeur `catalog.*` — marques/modèles véhicules : catalogue global (`organizationId: null`,
 * partagé entre toutes les organisations, lecture seule) + entrées locales par organisation
 * (ajoutées via `addLocalModel` quand un modèle manque au catalogue global). Lecture via
 * `adminDb` avec filtrage manuel, comme documenté dans `schema.prisma` pour `VehicleMake`/`VehicleModel`.
 */
export const catalogRouter = router({
  makes: requirePermission("vehicle:read")
    .input(catalogMakesInputSchema)
    .query(async ({ ctx, input }) => {
      return adminDb.vehicleMake.findMany({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: ctx.organizationId }],
          ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  models: requirePermission("vehicle:read")
    .input(catalogModelsInputSchema)
    .query(async ({ ctx, input }) => {
      return adminDb.vehicleModel.findMany({
        where: {
          makeId: input.makeId,
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: ctx.organizationId }],
          ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  addLocalModel: requirePermission("vehicle:create")
    .input(addLocalModelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const make = await adminDb.vehicleMake.upsert({
        where: { organizationId_name: { organizationId: ctx.organizationId, name: input.make } },
        create: { organizationId: ctx.organizationId, name: input.make },
        update: {},
      });

      const model = await adminDb.vehicleModel.upsert({
        where: {
          makeId_organizationId_name: {
            makeId: make.id,
            organizationId: ctx.organizationId,
            name: input.model,
          },
        },
        create: {
          organizationId: ctx.organizationId,
          makeId: make.id,
          name: input.model,
          serviceIntervalKm: input.serviceIntervalKm ?? null,
          serviceIntervalMonths: input.serviceIntervalMonths ?? null,
        },
        update: {
          serviceIntervalKm: input.serviceIntervalKm ?? undefined,
          serviceIntervalMonths: input.serviceIntervalMonths ?? undefined,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "catalog.local_model_added",
        entity: "VehicleModel",
        entityId: model.id,
        after: model,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { make, model };
    }),
});
