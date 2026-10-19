// M05 §8 / RG-M05-05 — catalogue de main-d'œuvre : opérations, forfaits, kits de pièces,
// durées par modèle, description client ; import CSV.
import { TRPCError } from "@trpc/server";
import { db, type Prisma } from "@atelieros/db";
import {
  archiveLaborOperationInputSchema,
  importLaborOperationsInputSchema,
  laborOperationInputSchema,
  laborOperationListInputSchema,
  updateLaborOperationInputSchema,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { orgProcedure, requirePermission, router } from "../trpc";

const RATE_TYPES = new Set(["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"]);

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? []) as Prisma.InputJsonValue;
}

/** CSV `code;nom;catégorie;heures;type de taux;forfait` (séparateur ; ou ,), en-tête facultatif. */
export function parseLaborCsv(csv: string) {
  const rows: {
    code: string;
    name: string;
    category: string | null;
    standardHours: number;
    rateType: string;
    fixedPrice: number | null;
  }[] = [];
  const errors: { line: number; message: string }[] = [];
  csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((raw, index) => {
      if (!raw) return;
      const cells = raw.split(raw.includes(";") ? ";" : ",").map((c) => c.trim());
      if (index === 0 && /^code$/i.test(cells[0] ?? "")) return;
      const [code, name, category, hours, rateType, fixed] = cells;
      const standardHours = Number((hours ?? "0").replace(",", "."));
      if (!code || !name)
        return errors.push({ line: index + 1, message: "Code et nom obligatoires." });
      if (!Number.isFinite(standardHours) || standardHours < 0) {
        return errors.push({ line: index + 1, message: "Temps barème invalide." });
      }
      const rt = (rateType || "STANDARD").toUpperCase();
      if (!RATE_TYPES.has(rt))
        return errors.push({ line: index + 1, message: "Type de taux inconnu." });
      const fixedPrice = fixed ? Number(fixed.replace(/[^0-9]/g, "")) : null;
      rows.push({
        code,
        name,
        category: category || null,
        standardHours,
        rateType: rt,
        fixedPrice: fixedPrice || null,
      });
    });
  return { rows, errors };
}

export const laborOperationRouter = router({
  list: orgProcedure.input(laborOperationListInputSchema).query(async ({ ctx, input }) => {
    if (
      !ctx.permissions.has("quote:read") &&
      !ctx.permissions.has("labor_catalog:manage") &&
      !ctx.permissions.has("repair_order:read")
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Permission manquante : quote:read" });
    }
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const contains = input.q ? { contains: input.q, mode: "insensitive" as const } : undefined;
    return tenantDb.laborOperation.findMany({
      where: {
        ...(input.includeArchived ? {} : { isActive: true }),
        ...(contains
          ? { OR: [{ name: contains }, { code: contains }, { category: contains }] }
          : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }),

  create: requirePermission("labor_catalog:manage")
    .input(laborOperationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.laborOperation.findFirst({ where: { code: input.code } });
      if (existing)
        throw new TRPCError({
          code: "CONFLICT",
          message: `Le code « ${input.code} » existe déjà.`,
        });
      const op = await tenantDb.laborOperation.create({
        data: {
          organizationId: ctx.organizationId,
          ...input,
          defaultParts: toJson(input.defaultParts),
          vehicleOverrides: toJson(input.vehicleOverrides),
        },
      });
      return op;
    }),

  update: requirePermission("labor_catalog:manage")
    .input(updateLaborOperationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const op = await tenantDb.laborOperation.findFirst({ where: { id: input.id } });
      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Opération introuvable." });
      const { defaultParts, vehicleOverrides, ...rest } = input.patch;
      return tenantDb.laborOperation.update({
        where: { id: op.id },
        data: {
          ...rest,
          ...(defaultParts ? { defaultParts: toJson(defaultParts) } : {}),
          ...(vehicleOverrides ? { vehicleOverrides: toJson(vehicleOverrides) } : {}),
        },
      });
    }),

  archive: requirePermission("labor_catalog:manage")
    .input(archiveLaborOperationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const op = await tenantDb.laborOperation.findFirst({ where: { id: input.id } });
      if (!op) throw new TRPCError({ code: "NOT_FOUND", message: "Opération introuvable." });
      return tenantDb.laborOperation.update({
        where: { id: op.id },
        data: { isActive: !input.archived },
      });
    }),

  import: requirePermission("labor_catalog:manage")
    .input(importLaborOperationsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const { rows, errors } = parseLaborCsv(input.csv);
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const existing = await tenantDb.laborOperation.findFirst({ where: { code: row.code } });
        const data = {
          name: row.name,
          category: row.category,
          standardHours: row.standardHours,
          rateType: row.rateType as "STANDARD",
          fixedPrice: row.fixedPrice,
        };
        if (existing) {
          await tenantDb.laborOperation.update({ where: { id: existing.id }, data });
          updated += 1;
        } else {
          await tenantDb.laborOperation.create({
            data: { organizationId: ctx.organizationId, code: row.code, ...data },
          });
          created += 1;
        }
      }
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "labor_catalog.imported",
        entity: "LaborOperation",
        entityId: ctx.organizationId,
        after: { created, updated, errors: errors.length },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { created, updated, errors };
    }),
});
