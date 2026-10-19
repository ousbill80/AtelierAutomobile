// M13 §8 — routeur `dataSources` (partie 2, étape 6.4) : sources de synchronisation par
// connexion directe à la base de l'ancien logiciel. Secrets chiffrés en base, en écriture
// seule (jamais renvoyés au front ni journalisés) ; requêtes et planning validés par
// `core/import/sync` avant tout enregistrement ; actions sensibles dans `AuditLog`.
import { TRPCError } from "@trpc/server";
import {
  assertReadOnlySelect,
  assertSyncSchedule,
  isDomainError,
  SYNC_ENTITY_ORDER,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  parseSqlSourceConfig,
  serializeSqlSourceConfig,
  type SqlSourceConfig,
} from "@atelieros/import";
import {
  createExternalDatabase,
  friendlyExternalDbError,
  loadEncryptionKey,
} from "@atelieros/integrations";
import {
  dataSourceCreateInputSchema,
  dataSourceIdInputSchema,
  dataSourcePreviewQueryInputSchema,
  dataSourceTestInputSchema,
  dataSourceUpdateInputSchema,
  type DataSourceCreateInput,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { getSyncRunner } from "../sync/queue";
import { requirePermission, router } from "../trpc";

const PREVIEW_ROWS = 20;

function badRequest(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

/** Valide requêtes (lecture seule) et planning avant enregistrement. */
function validateSourceInput(
  input: Partial<Pick<DataSourceCreateInput, "queries" | "schedule">>,
  timeZone: string,
) {
  try {
    for (const entity of SYNC_ENTITY_ORDER) {
      const sql = input.queries?.[entity];
      if (sql?.trim()) assertReadOnlySelect(sql);
    }
    if (input.schedule) assertSyncSchedule(input.schedule, timeZone);
  } catch (error) {
    badRequest(error);
  }
}

async function orgTimezone(organizationId: string): Promise<string> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return org.timezone;
}

type SourceRow = {
  id: string;
  type: string;
  name: string;
  schedule: string | null;
  isActive: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  config: string;
};

/** Vue publique d'une source : jamais le mot de passe, seulement « enregistré ». */
function present(row: SourceRow, key: Buffer) {
  let connection: Omit<SqlSourceConfig, "password"> & { hasPassword: boolean };
  try {
    const { password, ...rest } = parseSqlSourceConfig(row.config, key);
    connection = { ...rest, hasPassword: Boolean(password) };
  } catch {
    connection = { dbType: "memory", queries: {}, hasPassword: false };
  }
  const { config: _secret, ...publicRow } = row;
  void _secret;
  return { ...publicRow, connection };
}

const SOURCE_SELECT = {
  id: true,
  type: true,
  name: true,
  schedule: true,
  isActive: true,
  lastRunAt: true,
  lastStatus: true,
  lastSuccessAt: true,
  lastError: true,
  consecutiveFailures: true,
  config: true,
} as const;

export const dataSourcesRouter = router({
  list: requirePermission("integration:manage").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const key = loadEncryptionKey();
    const rows = await tenantDb.dataSource.findMany({
      where: { type: "SQL_DATABASE" },
      orderBy: { createdAt: "asc" },
      select: SOURCE_SELECT,
    });
    return rows.map((r) => present(r, key));
  }),

  get: requirePermission("integration:manage")
    .input(dataSourceIdInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const row = await tenantDb.dataSource.findFirst({
        where: { id: input.id },
        select: SOURCE_SELECT,
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
      // Journal des 30 dernières exécutions (M13 §7).
      const runs = await tenantDb.importJob.findMany({
        where: { dataSourceId: input.id },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: {
          id: true,
          entity: true,
          status: true,
          createdAt: true,
          totalRows: true,
          createdCount: true,
          updatedCount: true,
          unchangedCount: true,
          errorCount: true,
        },
      });
      return { ...present(row, loadEncryptionKey()), runs };
    }),

  create: requirePermission("integration:manage")
    .input(dataSourceCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      validateSourceInput(input, await orgTimezone(ctx.organizationId));
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const { name, schedule, isActive, ...connection } = input;
      const created = await tenantDb.dataSource.create({
        data: {
          organizationId: ctx.organizationId,
          type: "SQL_DATABASE",
          name,
          schedule,
          isActive,
          config: serializeSqlSourceConfig(connection, loadEncryptionKey()),
        },
        select: { id: true },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "data_source.created",
        entity: "DataSource",
        entityId: created.id,
        after: { name, schedule, isActive, dbType: input.dbType, host: input.host },
      });
      return created;
    }),

  update: requirePermission("integration:manage")
    .input(dataSourceUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      validateSourceInput(input, await orgTimezone(ctx.organizationId));
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const existing = await tenantDb.dataSource.findFirst({
        where: { id: input.id },
        select: { id: true, config: true, name: true, schedule: true, isActive: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
      const key = loadEncryptionKey();
      const current = parseSqlSourceConfig(existing.config, key);
      const { id, name, schedule, isActive, password, ...rest } = input;
      const next: SqlSourceConfig = {
        ...current,
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        // Mot de passe vide ou absent : on garde celui enregistré.
        password: password ? password : current.password,
      };
      await tenantDb.dataSource.update({
        where: { id },
        data: {
          name,
          schedule,
          isActive,
          config: serializeSqlSourceConfig(next, key),
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "data_source.updated",
        entity: "DataSource",
        entityId: id,
        before: { name: existing.name, schedule: existing.schedule, isActive: existing.isActive },
        after: {
          name: name ?? existing.name,
          schedule: schedule ?? existing.schedule,
          isActive: isActive ?? existing.isActive,
          passwordChanged: Boolean(password),
        },
      });
      return { ok: true };
    }),

  /** Pas de suppression physique : l'historique des imports reste rattaché (désactivation). */
  delete: requirePermission("integration:manage")
    .input(dataSourceIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const result = await tenantDb.dataSource.updateMany({
        where: { id: input.id, type: "SQL_DATABASE" },
        data: { isActive: false },
      });
      if (result.count === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
      }
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "data_source.deactivated",
        entity: "DataSource",
        entityId: input.id,
      });
      return { ok: true };
    }),

  test: requirePermission("integration:manage")
    .input(dataSourceTestInputSchema)
    .mutation(async ({ ctx, input }) => {
      let config: SqlSourceConfig;
      if ("id" in input) {
        const row = await db
          .forTenant({ organizationId: ctx.organizationId })
          .dataSource.findFirst({ where: { id: input.id }, select: { config: true } });
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
        config = parseSqlSourceConfig(row.config, loadEncryptionKey());
      } else {
        config = { ...input, queries: {} };
      }
      try {
        const result = await createExternalDatabase(config).test();
        return { ok: true as const, ...result };
      } catch (error) {
        return { ok: false as const, error: friendlyExternalDbError(error).message };
      }
    }),

  previewQuery: requirePermission("integration:manage")
    .input(dataSourcePreviewQueryInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        assertReadOnlySelect(input.sql);
      } catch (error) {
        badRequest(error);
      }
      const row = await db
        .forTenant({ organizationId: ctx.organizationId })
        .dataSource.findFirst({ where: { id: input.id }, select: { config: true } });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
      const config = parseSqlSourceConfig(row.config, loadEncryptionKey());
      try {
        // Aperçu : `:since` au début de l'historique, 20 premières lignes affichées.
        const result = await createExternalDatabase(config).query(input.sql, new Date(0));
        return { columns: result.columns, rows: result.rows.slice(0, PREVIEW_ROWS) };
      } catch (error) {
        badRequest(friendlyExternalDbError(error));
      }
    }),

  runNow: requirePermission("integration:manage")
    .input(dataSourceIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const source = await db
        .forTenant({ organizationId: ctx.organizationId })
        .dataSource.findFirst({
          where: { id: input.id, type: "SQL_DATABASE" },
          select: { id: true, syncAgents: { select: { id: true }, take: 1 } },
        });
      if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source introuvable." });
      if (source.syncAgents.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cette source est alimentée par l'agent local installé au garage.",
        });
      }
      return getSyncRunner().run({ organizationId: ctx.organizationId, dataSourceId: source.id });
    }),
});
