// M05 RG-M05-05 — catalogue de main-d'œuvre : opérations, forfaits, kits de pièces, durées
// par modèle, description client. `labor_catalog:manage` pour écrire, `quote:read` pour lire.
import { TRPCError } from "@trpc/server";
import { laborLinePricing, laborRatesFrom } from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import {
  laborOperationIdInputSchema,
  laborOperationImportInputSchema,
  laborOperationInputSchema,
  laborOperationListInputSchema,
  laborOperationUpdateInputSchema,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { orgProcedure, requirePermission, router } from "../trpc";

function toData(input: {
  code?: string;
  name?: string;
  category?: string | null;
  standardHours?: number;
  rateType?: "STANDARD" | "DIAGNOSTIC" | "BODYWORK" | "ELECTRICAL";
  fixedPrice?: number | null;
  customerDescription?: string | null;
  defaultParts?: unknown[];
  vehicleOverrides?: unknown[];
  isServiceOperation?: boolean;
}) {
  return {
    code: input.code,
    name: input.name,
    category: input.category,
    standardHours: input.standardHours,
    rateType: input.rateType,
    fixedPrice: input.fixedPrice,
    customerDescription: input.customerDescription,
    defaultParts: input.defaultParts as Prisma.InputJsonValue | undefined,
    vehicleOverrides: input.vehicleOverrides as Prisma.InputJsonValue | undefined,
    isServiceOperation: input.isServiceOperation,
  };
}

export const laborOperationRouter = router({
  list: orgProcedure.input(laborOperationListInputSchema).query(async ({ ctx, input }) => {
    if (!ctx.permissions.has("quote:read") && !ctx.permissions.has("labor_catalog:manage")) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Permission manquante : quote:read" });
    }
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { settings: true },
    });
    const rates = laborRatesFrom(org.settings);
    const ops = await tenantDb.laborOperation.findMany({
      where: {
        ...(input.includeArchived ? {} : { isActive: true }),
        ...(input.q
          ? {
              OR: [
                { name: { contains: input.q, mode: "insensitive" } },
                { code: { contains: input.q, mode: "insensitive" } },
                { category: { contains: input.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return ops.map((op) => ({ ...op, pricing: laborLinePricing(op, rates) }));
  }),

  create: requirePermission("labor_catalog:manage")
    .input(laborOperationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.laborOperation.findFirst({ where: { code: input.code } });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `Le code ${input.code} existe déjà.` });
      }
      const op = await tenantDb.laborOperation.create({
        data: {
          organizationId: ctx.organizationId,
          ...toData(input),
          code: input.code,
          name: input.name,
          standardHours: input.standardHours,
          defaultParts: (input.defaultParts ?? []) as Prisma.InputJsonValue,
          vehicleOverrides: (input.vehicleOverrides ?? []) as Prisma.InputJsonValue,
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "labor_operation.created",
        entity: "LaborOperation",
        entityId: op.id,
        after: op,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return op;
    }),

  update: requirePermission("labor_catalog:manage")
    .input(laborOperationUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.laborOperation.findFirst({ where: { id: input.id } });
      if (!before) throw new TRPCError({ code: "NOT_FOUND", message: "Opération introuvable." });
      if (input.patch.code && input.patch.code !== before.code) {
        const clash = await tenantDb.laborOperation.findFirst({ where: { code: input.patch.code } });
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `Le code ${input.patch.code} existe déjà.` });
        }
      }
      const op = await tenantDb.laborOperation.update({
        where: { id: before.id },
        data: toData(input.patch),
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "labor_operation.updated",
        entity: "LaborOperation",
        entityId: op.id,
        before,
        after: op,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return op;
    }),

  archive: requirePermission("labor_catalog:manage")
    .input(laborOperationIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const op = await tenantDb.laborOperation.findFirst({ where: { id: input.id } });
      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Opération introuvable." });
      return tenantDb.laborOperation.update({
        where: { id: op.id },
        data: { isActive: !op.isActive },
      });
    }),

  /** Import CSV (lignes déjà analysées côté client) : création ou mise à jour par code. */
  import: requirePermission("labor_catalog:manage")
    .input(laborOperationImportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      let created = 0;
      let updated = 0;
      for (const row of input.rows) {
        const existing = await tenantDb.laborOperation.findFirst({ where: { code: row.code } });
        if (existing) {
          await tenantDb.laborOperation.update({ where: { id: existing.id }, data: toData(row) });
          updated += 1;
        } else {
          await tenantDb.laborOperation.create({
            data: {
              organizationId: ctx.organizationId,
              ...toData(row),
              code: row.code,
              name: row.name,
              standardHours: row.standardHours,
              defaultParts: (row.defaultParts ?? []) as Prisma.InputJsonValue,
              vehicleOverrides: (row.vehicleOverrides ?? []) as Prisma.InputJsonValue,
            },
          });
          created += 1;
        }
      }
      return { created, updated };
    }),
});
