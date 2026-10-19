import { TRPCError } from "@trpc/server";
import { generateCiHolidays } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  createHolidayInputSchema,
  deleteHolidayInputSchema,
  listHolidaysInputSchema,
  seedHolidayYearInputSchema,
  updateHolidayInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

// RG-M15-08 — jours fériés ivoiriens (fixes + estimés, `core/ci-holidays.ts`) et fermetures
// exceptionnelles propres à un site (`kind = "CLOSURE"`). Permission alignée sur site.ts
// (table M15 §10 : « Sites et ponts, horaires, jours fériés » → `site:manage`).

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export const holidayRouter = router({
  list: requirePermission("site:manage")
    .input(listHolidaysInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.holiday.findMany({
        where: {
          date: {
            gte: new Date(Date.UTC(input.year, 0, 1)),
            lt: new Date(Date.UTC(input.year + 1, 0, 1)),
          },
          ...(input.siteId ? { siteId: input.siteId } : {}),
        },
        orderBy: { date: "asc" },
      });
    }),

  create: requirePermission("site:manage")
    .input(createHolidayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const siteId = input.siteId ?? null;
      const date = toUtcDateOnly(input.date);

      // RG-M15-08 : pas de doublon pour la même date + le même site (ou "tous les sites").
      // L'index `@@unique([organizationId, siteId, date])` ne déduplique pas de façon fiable
      // les lignes `siteId = NULL` sous Postgres (NULL ≠ NULL) : vérification applicative.
      const existing = await tenantDb.holiday.findFirst({ where: { date, siteId } });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Un jour férié existe déjà à cette date pour ce site.",
        });
      }

      const holiday = await tenantDb.holiday.create({
        data: {
          organizationId: ctx.organizationId,
          date,
          name: input.name,
          kind: input.kind,
          siteId,
          isEstimated: input.isEstimated,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: holiday.siteId,
        action: "holiday.created",
        entity: "Holiday",
        entityId: holiday.id,
        after: holiday,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return holiday;
    }),

  update: requirePermission("site:manage")
    .input(updateHolidayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.holiday.findUniqueOrThrow({ where: { id: input.holidayId } });

      const holiday = await tenantDb.holiday.update({
        where: { id: input.holidayId },
        data: {
          date: input.date ? toUtcDateOnly(input.date) : undefined,
          name: input.name,
          kind: input.kind,
          isEstimated: input.isEstimated,
        },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: holiday.siteId,
        action: "holiday.updated",
        entity: "Holiday",
        entityId: holiday.id,
        before,
        after: holiday,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return holiday;
    }),

  delete: requirePermission("site:manage")
    .input(deleteHolidayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.holiday.findUniqueOrThrow({ where: { id: input.holidayId } });

      await tenantDb.holiday.delete({ where: { id: input.holidayId } });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        siteId: before.siteId,
        action: "holiday.deleted",
        entity: "Holiday",
        entityId: before.id,
        before,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { ok: true } as const;
    }),

  // RG-M15-08 : génération annuelle (manuelle ici ; la tâche planifiée du 1er décembre
  // appellera cette même logique de service une fois l'infra de jobs disponible — M15 §9,
  // hors périmètre de cette étape).
  seedYear: requirePermission("site:manage")
    .input(seedHolidayYearInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const generated = generateCiHolidays(input.year);

      const created = [];
      for (const holiday of generated) {
        const date = new Date(
          Date.UTC(holiday.date.year, holiday.date.month - 1, holiday.date.day),
        );
        const existing = await tenantDb.holiday.findFirst({ where: { date, siteId: null } });
        if (existing) continue;
        const row = await tenantDb.holiday.create({
          data: {
            organizationId: ctx.organizationId,
            date,
            name: holiday.name,
            kind: "PUBLIC",
            siteId: null,
            isEstimated: holiday.isEstimated,
          },
        });
        created.push(row);
      }

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "holiday.seeded",
        entity: "Holiday",
        entityId: String(input.year),
        after: { year: input.year, count: created.length },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return created;
    }),
});
