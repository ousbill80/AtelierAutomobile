/**
 * Relit le fichier source depuis le stockage objet et reconstruit les lignes
 * mappées/validées (RG-M13-16) à partir du mapping enregistré sur
 * `ImportJob.mapping`. Partagé entre le routeur tRPC (prévisualisation :
 * `validate`/`patchRow`/`simulate`) et le worker BullMQ (exécution réelle :
 * `imports.run`), pour ne jamais dupliquer cette logique (CLAUDE.md).
 */
import type { CsvDelimiter, DetectedEncoding, ImportPolicy, TargetField } from "@atelieros/core";
import {
  buildAnalyzedRows,
  parseImportFile,
  type AnalyzedRow,
  type ImportEntityName,
  type ParsedImportFile,
} from "./pipeline";

export interface ImportJobMapping {
  columns?: Record<string, TargetField>;
  options?: { policy?: ImportPolicy; dateFormat?: string; treatMissingAsPaid?: boolean };
  overrides?: Record<string, Record<string, unknown>>;
}

export interface ObjectStorageReader {
  getObjectBytes(key: string): Promise<Uint8Array>;
}

export interface JobFileRef {
  fileUrl: string | null;
  fileName: string | null;
  encoding: string | null;
  delimiter: string | null;
}

function applyOverrides(
  rows: AnalyzedRow[],
  overrides: Record<string, Record<string, unknown>> | undefined,
): AnalyzedRow[] {
  if (!overrides) return rows;
  return rows.map((row) => {
    const patch = overrides[String(row.rowNumber)];
    if (!patch) return row;
    return { ...row, values: { ...row.values, ...patch } };
  });
}

export interface BuildJobRowsResult {
  parsed: ParsedImportFile;
  rows: AnalyzedRow[];
}

/** Lit, mappe et valide à nouveau les lignes d'un job, depuis son fichier source et son mapping enregistré. */
export async function buildJobRows(
  storage: ObjectStorageReader,
  job: JobFileRef,
  entity: ImportEntityName,
  mapping: ImportJobMapping,
  now: Date,
): Promise<BuildJobRowsResult> {
  if (!job.fileUrl) {
    throw new Error("Aucun fichier associé à cet import.");
  }
  const bytes = await storage.getObjectBytes(job.fileUrl);
  const parsed = await parseImportFile(bytes, {
    fileName: job.fileName ?? job.fileUrl,
    forcedEncoding: (job.encoding as DetectedEncoding | undefined) ?? undefined,
    forcedDelimiter: (job.delimiter as CsvDelimiter | undefined) ?? undefined,
  });
  const rows = applyOverrides(
    buildAnalyzedRows(parsed, entity, mapping.columns ?? {}, now),
    mapping.overrides,
  );
  return { parsed, rows };
}
