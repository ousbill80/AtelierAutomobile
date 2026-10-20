import { TRPCError } from "@trpc/server";
import type { Prisma } from "@atelieros/db";
import { db, loadOrgPlan } from "@atelieros/db";
import { auditExportInputSchema, auditListInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

// audit.export : implémentation simplifiée (CSV encodé en data URL, génération synchrone).
// L'adaptateur de stockage de fichiers signé/asynchrone arrive en Étape 0.5 ; à remplacer alors.
const EXPORT_MAX_ROWS = 50_000;

function buildWhere(
  input: {
    userId?: string;
    action?: string;
    entity?: string;
    entityId?: string;
    siteId?: string;
    from?: Date;
    to?: Date;
  },
  retentionStart: Date,
): Prisma.AuditLogWhereInput {
  // RG-M15-26 : profondeur consultable selon le plan (90 j / 1 an / 3 ans), conservation 10 ans.
  const from = input.from && input.from > retentionStart ? input.from : retentionStart;
  return {
    userId: input.userId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    siteId: input.siteId,
    createdAt: { gte: from, lte: input.to },
  };
}

async function retentionStartFor(organizationId: string): Promise<Date> {
  const { plan } = await loadOrgPlan(organizationId);
  return new Date(Date.now() - plan.quotas.auditRetentionDays * 86_400_000);
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const auditRouter = router({
  list: requirePermission("audit:read")
    .input(auditListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const { cursor, limit, ...filters } = input;

      const items = await tenantDb.auditLog.findMany({
        where: buildWhere(filters, await retentionStartFor(ctx.organizationId)),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        items.pop();
        nextCursor = items[items.length - 1]?.id;
      }

      return { items, nextCursor };
    }),

  export: requirePermission("audit:read")
    .input(auditExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const rows = await tenantDb.auditLog.findMany({
        where: buildWhere(input, await retentionStartFor(ctx.organizationId)),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: EXPORT_MAX_ROWS,
      });

      if (rows.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Aucune entrée de journal ne correspond à ces filtres.",
        });
      }

      const header = [
        "createdAt",
        "action",
        "entity",
        "entityId",
        "userId",
        "membershipId",
        "siteId",
        "reason",
      ];
      const lines = [header.join(",")];
      for (const row of rows) {
        lines.push(
          [
            row.createdAt.toISOString(),
            row.action,
            row.entity,
            row.entityId,
            row.userId,
            row.membershipId,
            row.siteId,
            row.reason,
          ]
            .map(csvEscape)
            .join(","),
        );
      }

      const csv = lines.join("\n");
      const fileUrl = `data:text/csv;base64,${Buffer.from(csv, "utf-8").toString("base64")}`;

      return { fileUrl };
    }),
});
