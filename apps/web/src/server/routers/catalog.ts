import { TRPCError } from "@trpc/server";
import { db } from "@atelieros/db";
import {
  addLocalModelInputSchema,
  catalogMakesInputSchema,
  catalogModelsInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

export const catalogRouter = router({
  makes: requirePermission("vehicle:read")
    .input(catalogMakesInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.vehicleMake.findMany({
        where: {
          isActive: true,
          ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  models: requirePermission("vehicle:read")
    .input(catalogModelsInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.vehicleModel.findMany({
        where: {
          makeId: input.makeId,
          isActive: true,
          ...(input.q ? { name: { contains: input.q, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
      });
    }),

  addLocalModel: requirePermission("vehicle:create")
    .input(addLocalModelInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      let make = await tenantDb.vehicleMake.findFirst({ where: { name: input.make } });
      if (!make) {
        make = await tenantDb.vehicleMake.create({
          data: { organizationId: ctx.organizationId, name: input.make },
        });
      }
      if (!make) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Impossible de créer la marque.",
        });
      }

      return tenantDb.vehicleModel.create({
        data: {
          organizationId: ctx.organizationId,
          makeId: make.id,
          name: input.model,
          serviceIntervalKm: input.serviceIntervalKm,
          serviceIntervalMonths: input.serviceIntervalMonths,
        },
      });
    }),
});
