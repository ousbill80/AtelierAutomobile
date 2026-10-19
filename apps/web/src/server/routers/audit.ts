import { TRPCError } from "@trpc/server";
import type { Prisma } from "@atelieros/db";
import { adminDb, db } from "@atelieros/db";
import { auditExportInputSchema, auditListInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

// audit.export : implémentation simplifiée (CSV encodé en data URL, génération synchrone).
// L'adaptateur de stockage de fichiers signé/asynchrone arrive en Étape 0.5 ; à remplacer alors.
const EXPORT_MAX_ROWS = 50_000;

function buildWhere(input: {
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
}): Prisma.AuditLogWhereInput {
  return {
    userId: input.userId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    siteId: input.siteId,
    createdAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
  };
}

/** Noms des utilisateurs référencés par le journal (table User non multi-locataire). */
async function loadUsers(userIds: Array<string | null>) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0)
    return {} as Record<string, { id: string; name: string; email: string | null }>;
  const rows = await adminDb.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  return Object.fromEntries(rows.map((u) => [u.id, u])) as Record<
    string,
    { id: string; name: string; email: string | null }
  >;
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
        where: buildWhere(filters),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (items.length > limit) {
        items.pop();
        nextCursor = items[items.length - 1]?.id;
      }

      const users = await loadUsers(items.map((row) => row.userId));
      return {
        items: items.map((row) => ({
          ...row,
          user: row.userId ? (users[row.userId] ?? null) : null,
        })),
        nextCursor,
      };
    }),

  /** Valeurs distinctes (actions, utilisateurs) présentes dans le journal, pour les filtres. */
  facets: requirePermission("audit:read").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const [actions, userRows] = await Promise.all([
      tenantDb.auditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
      tenantDb.auditLog.findMany({ distinct: ["userId"], select: { userId: true } }),
    ]);
    const users = await loadUsers(userRows.map((row) => row.userId));
    return {
      actions: actions.map((row) => row.action),
      users: Object.values(users).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    };
  }),

  export: requirePermission("audit:read")
    .input(auditExportInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });

      const rows = await tenantDb.auditLog.findMany({
        where: buildWhere(input),
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
