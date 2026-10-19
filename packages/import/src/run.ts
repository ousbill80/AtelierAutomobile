/**
 * RG-M13-24 — exécution réelle du pipeline par lots de 500 lignes. Partage le
 * dispatcheur `applyImportRow` avec `simulate.ts` (seul `dryRun` change), afin
 * que la simulation et l'exécution ne puissent jamais diverger.
 */
import type { ImportPolicy } from "@atelieros/core";
import { rowHasBlockingError, type AnalyzedRow } from "./pipeline";
import { applyImportRow, dedupeImportRows, type SupportedEntity, type TenantDb } from "./simulate";

const BATCH_SIZE = 500; // RG-M13-24

export class ImportHasErrorsError extends Error {
  constructor(public readonly count: number) {
    super(`${count} ligne(s) en erreur. Corrigez-les ou cochez « ignorer les erreurs ».`);
    this.name = "ImportHasErrorsError";
  }
}

export interface RunImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
  severity: string;
  raw: unknown;
}

export interface RunImportCounts {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  error: number;
}

export interface RunImportResult extends RunImportCounts {
  rowErrors: RunImportRowError[];
  totalApplicable: number;
}

export interface RunImportInput {
  tenantDb: TenantDb;
  organizationId: string;
  entity: SupportedEntity;
  rows: readonly AnalyzedRow[];
  policy: ImportPolicy;
  jobId: string;
  now: Date;
  skipErrors: boolean;
  userId?: string | null;
  membershipId?: string | null;
  /** RG-M13-24 — publié au plus toutes les 2 s (`ImportJob.processedRows`), et systématiquement au dernier lot. */
  onProgress?: (processedRows: number, totalApplicable: number) => Promise<void> | void;
}

const PROGRESS_INTERVAL_MS = 2000; // RG-M13-24

/**
 * RG-M13-24 — applique les lignes gagnantes (après dédoublonnage intra-
 * fichier) par lots de 500 ; lève `ImportHasErrorsError` si des lignes en
 * erreur subsistent et que `skipErrors` n'a pas été coché par l'utilisateur.
 */
export async function runImport(input: RunImportInput): Promise<RunImportResult> {
  const {
    tenantDb,
    organizationId,
    entity,
    rows,
    policy,
    jobId,
    now,
    skipErrors,
    userId,
    membershipId,
    onProgress,
  } = input;

  const { winningRows, mergedCount } = dedupeImportRows(entity, rows);
  const blocking = winningRows.filter((r) => rowHasBlockingError(r));
  if (blocking.length > 0 && !skipErrors) {
    throw new ImportHasErrorsError(blocking.length);
  }

  const rowErrors: RunImportRowError[] = [];
  for (const row of winningRows) {
    for (const issue of row.issues) {
      rowErrors.push({
        rowNumber: row.rowNumber,
        field: issue.field,
        message: issue.message,
        severity: issue.severity,
        raw: row.values,
      });
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = mergedCount;
  let errored = blocking.length;

  const applicable = winningRows.filter((r) => !rowHasBlockingError(r));
  let lastProgressAt = Date.now();

  for (let i = 0; i < applicable.length; i += BATCH_SIZE) {
    const batch = applicable.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      const result = await applyImportRow({
        tenantDb,
        organizationId,
        entity,
        values: row.values,
        policy,
        dryRun: false,
        jobId,
        now,
        userId,
        membershipId,
      });

      if (result.outcome === "create") created += 1;
      else if (result.outcome === "update") updated += 1;
      else if (result.outcome === "unchanged") unchanged += 1;
      else if (result.outcome === "error") {
        errored += 1;
        rowErrors.push({
          rowNumber: row.rowNumber,
          message: result.error ?? "Erreur inconnue lors de l'import.",
          severity: "ERROR",
          raw: row.values,
        });
      } else {
        skipped += 1;
      }
    }

    const processed = Math.min(i + batch.length, applicable.length);
    const isLastBatch = processed === applicable.length;
    const elapsed = Date.now() - lastProgressAt;
    if (onProgress && (isLastBatch || elapsed >= PROGRESS_INTERVAL_MS)) {
      await onProgress(processed, applicable.length);
      lastProgressAt = Date.now();
    }
  }

  return {
    create: created,
    update: updated,
    unchanged,
    skip: skipped,
    error: errored,
    rowErrors,
    totalApplicable: applicable.length,
  };
}
