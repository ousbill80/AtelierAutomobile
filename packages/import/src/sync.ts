/**
 * M13 partie 2 — exécution d'une synchronisation « connexion directe » (RG-M13-25 à 27).
 * Chaque requête configurée (une par entité, dans l'ordre clients → véhicules → factures →
 * paiements) est exécutée en lecture seule sur la base externe ; ses lignes passent ensuite
 * par **le même** pipeline qu'un fichier (`buildAnalyzedRows` → `runImport`), donc mêmes
 * normalisations, même dédoublonnage et mêmes politiques de mise à jour. Un `ImportJob` est
 * créé par entité pour l'historique `/import`. Appelé par le worker (`sync.run`) et jamais
 * directement par un routeur, qui ne fait qu'enqueuer.
 */
import {
  assertReadOnlySelect,
  isDomainError,
  mapSyncColumns,
  shouldNotifySyncFailure,
  sinceFor,
  SYNC_ENTITY_ORDER,
  type ImportPolicy,
  type SyncEntity,
  type WatchRule,
} from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  createExternalDatabase,
  decryptSecret,
  encryptSecret,
  type ExternalDatabase,
  type ExternalDbConfig,
} from "@atelieros/integrations";
import { buildAnalyzedRows, type ParsedImportFile } from "./pipeline";
import { runImport } from "./run";

/** Contenu (chiffré en base) de `DataSource.config` pour une source `SQL_DATABASE` (M13 §6). */
export interface SqlSourceConfig extends ExternalDbConfig {
  queries: Partial<Record<SyncEntity, string>>;
  /** Agent local : fichiers du dossier surveillé et entité de chacun (RG-M13-29). */
  watchRules?: WatchRule[];
  policy?: ImportPolicy;
}

export function parseSqlSourceConfig(encrypted: string, key: Buffer): SqlSourceConfig {
  const raw = JSON.parse(decryptSecret(encrypted, key)) as Partial<SqlSourceConfig>;
  return { dbType: raw.dbType ?? "memory", ...raw, queries: raw.queries ?? {} } as SqlSourceConfig;
}

export function serializeSqlSourceConfig(config: SqlSourceConfig, key: Buffer): string {
  return encryptSecret(JSON.stringify(config), key);
}

export interface SyncEntityResult {
  entity: SyncEntity;
  jobId: string;
  rows: number;
  create: number;
  update: number;
  unchanged: number;
  error: number;
}

export interface RunSqlSyncResult {
  status: "SUCCESS" | "FAILED";
  entities: SyncEntityResult[];
  error?: string;
}

export interface RunSqlSyncInput {
  organizationId: string;
  dataSourceId: string;
  encryptionKey: Buffer;
  now: Date;
  /** Injectable pour les tests (base `memory`) ; défaut : pilote réel selon `dbType`. */
  createDb?: (config: SqlSourceConfig) => ExternalDatabase;
}

export interface ImportSyncRowsInput {
  organizationId: string;
  dataSourceId: string;
  sourceName: string;
  entity: SyncEntity;
  /** Colonnes et lignes telles que lues dans la base source (requête serveur ou lot d'agent). */
  result: { columns: string[]; rows: string[][] };
  policy: ImportPolicy;
  now: Date;
}

/**
 * Applique des lignes issues d'une base source avec le pipeline d'import (même chemin qu'un
 * fichier) et trace l'exécution dans un `ImportJob`. Partagé par la connexion directe
 * (`runSqlSync`) et les lots de l'agent local (`POST /api/v1/sync/batches`).
 */
export async function importSyncRows(input: ImportSyncRowsInput): Promise<SyncEntityResult> {
  const { organizationId, dataSourceId, sourceName, entity, result, policy, now } = input;
  const tenantDb = db.forTenant({ organizationId });
  const columns = mapSyncColumns(entity, result.columns);
  const parsed: ParsedImportFile = {
    format: "csv",
    encoding: null,
    delimiter: null,
    headers: result.columns,
    rows: result.rows,
    rowNumbers: result.rows.map((_, i) => i + 1),
  };
  const rows = buildAnalyzedRows(parsed, entity, columns, now);
  const job = await tenantDb.importJob.create({
    data: {
      organizationId,
      dataSourceId,
      entity,
      fileName: `synchro ${sourceName} — ${entity}`,
      mapping: { columns },
      policy,
      status: "RUNNING",
      totalRows: rows.length,
      startedAt: now,
    },
  });
  const run = await runImport({
    tenantDb,
    organizationId,
    entity,
    rows,
    policy,
    jobId: job.id,
    now,
    // Synchro automatique : les lignes en erreur sont écartées et tracées, jamais bloquantes.
    skipErrors: true,
  });
  if (run.rowErrors.length > 0) {
    await tenantDb.importRowError.createMany({
      data: run.rowErrors.map((e) => ({
        organizationId,
        importJobId: job.id,
        rowNumber: e.rowNumber,
        field: e.field,
        message: e.message,
        severity: e.severity,
        raw: e.raw as object,
      })),
    });
  }
  await tenantDb.importJob.update({
    where: { id: job.id },
    data: {
      status: "COMPLETED",
      finishedAt: now,
      processedRows: run.totalApplicable,
      createdCount: run.create,
      updatedCount: run.update,
      unchangedCount: run.unchanged,
      skippedCount: run.skip,
      errorCount: run.error,
    },
  });
  return {
    entity,
    jobId: job.id,
    rows: rows.length,
    create: run.create,
    update: run.update,
    unchanged: run.unchanged,
    error: run.error,
  };
}

/** Exécute une synchronisation complète d'une source `SQL_DATABASE` et met à jour son suivi. */
export async function runSqlSync(input: RunSqlSyncInput): Promise<RunSqlSyncResult> {
  const { organizationId, dataSourceId, now } = input;
  const tenantDb = db.forTenant({ organizationId });
  const source = await tenantDb.dataSource.findFirstOrThrow({ where: { id: dataSourceId } });
  const entities: SyncEntityResult[] = [];

  try {
    const config = parseSqlSourceConfig(source.config, input.encryptionKey);
    const external = (input.createDb ?? createExternalDatabase)(config);
    const since = sinceFor(source.lastSuccessAt);
    try {
      for (const entity of SYNC_ENTITY_ORDER) {
        const sql = config.queries[entity];
        if (!sql?.trim()) continue;
        assertReadOnlySelect(sql);
        const result = await external.query(sql, since);
        entities.push(
          await importSyncRows({
            organizationId,
            dataSourceId,
            sourceName: source.name,
            entity,
            result,
            policy: config.policy ?? "UPSERT",
            now,
          }),
        );
      }
    } finally {
      await external.close();
    }

    await tenantDb.dataSource.update({
      where: { id: dataSourceId },
      data: {
        lastRunAt: now,
        lastStatus: "SUCCESS",
        lastSuccessAt: now,
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    return { status: "SUCCESS", entities };
  } catch (error) {
    // Seuls les messages métier traduits sont conservés (jamais le message brut d'un pilote).
    const message = isDomainError(error)
      ? error.message
      : "Erreur inattendue pendant la synchronisation.";
    const failures = source.consecutiveFailures + 1;
    await tenantDb.dataSource.update({
      where: { id: dataSourceId },
      data: {
        lastRunAt: now,
        lastStatus: "FAILED",
        consecutiveFailures: failures,
        lastError: message,
      },
    });
    if (shouldNotifySyncFailure(failures)) {
      const owners = await tenantDb.membership.findMany({
        where: { role: "OWNER", isActive: true },
        select: { id: true },
      });
      await tenantDb.notification.createMany({
        data: owners.map((o) => ({
          organizationId,
          membershipId: o.id,
          type: "import.sync_failed",
          title: `Synchronisation « ${source.name} » en échec 3 fois de suite`,
          body: message,
          link: `/import/sources/${dataSourceId}`,
          severity: "critical",
        })),
      });
    }
    return { status: "FAILED", entities, error: message };
  }
}
