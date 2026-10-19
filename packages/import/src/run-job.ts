/**
 * Traitement de bout en bout d'un job d'exécution d'import (`imports.run`) :
 * relit le fichier, applique les lignes par lots de 500 (RG-M13-24), écrit
 * `ImportRowError` et met à jour les compteurs/statut d'`ImportJob`. Appelé
 * par le worker BullMQ de la file `imports` (`apps/worker`) — jamais
 * directement par le routeur tRPC, qui ne fait qu'enqueuer un job (CLAUDE.md :
 * « Routeurs, jobs et API ne font qu'orchestrer »).
 */
import { db, type ImportPolicy as DbImportPolicy } from "@atelieros/db";
import { buildJobRows, type ImportJobMapping, type ObjectStorageReader } from "./job-rows";
import type { ImportEntityName } from "./pipeline";
import { isSupportedEntity } from "./simulate";
import { ImportHasErrorsError, runImport } from "./run";

export interface RunImportJobData {
  jobId: string;
  organizationId: string;
  skipErrors: boolean;
  userId?: string | null;
  membershipId?: string | null;
}

export interface ProcessImportRunJobDeps {
  storage: ObjectStorageReader;
  /** Horloge injectable (CLAUDE.md : jamais `new Date()` directement dans la logique métier). */
  now?: () => Date;
}

/**
 * RG-M13-24 — exécute réellement un import déjà simulé. Idempotent au sens où
 * rejouer un job déjà `COMPLETED` ne recrée rien (politique de fusion par
 * hash/clé de correspondance) mais n'est normalement jamais réinvoqué par le
 * worker (`jobId` BullMQ = `ImportJob.id`, un seul job actif à la fois).
 */
export async function processImportRunJob(
  data: RunImportJobData,
  deps: ProcessImportRunJobDeps,
): Promise<void> {
  const now = deps.now ? deps.now() : new Date();
  const tenantDb = db.forTenant({ organizationId: data.organizationId });

  const job = await tenantDb.importJob.findFirst({ where: { id: data.jobId } });
  if (!job) return; // Job supprimé ou organisation invalide : rien à traiter.

  const entity = job.entity as ImportEntityName;
  if (!isSupportedEntity(entity)) {
    await tenantDb.importJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    return;
  }

  await tenantDb.importJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: now, processedRows: 0 },
  });

  try {
    const mapping = (job.mapping as ImportJobMapping) ?? {};
    const { rows } = await buildJobRows(
      deps.storage,
      {
        fileUrl: job.fileUrl,
        fileName: job.fileName,
        encoding: job.encoding,
        delimiter: job.delimiter,
      },
      entity,
      mapping,
      now,
    );

    const result = await runImport({
      tenantDb,
      organizationId: data.organizationId,
      entity,
      rows,
      policy: job.policy as DbImportPolicy,
      jobId: job.id,
      now,
      skipErrors: data.skipErrors,
      userId: data.userId,
      membershipId: data.membershipId,
      onProgress: async (processed) => {
        await tenantDb.importJob.update({
          where: { id: job.id },
          data: { processedRows: processed },
        });
      },
    });

    if (result.rowErrors.length > 0) {
      await tenantDb.importRowError.createMany({
        data: result.rowErrors.map((e) => ({
          organizationId: data.organizationId,
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
        finishedAt: new Date(),
        processedRows: result.totalApplicable,
        createdCount: result.create,
        updatedCount: result.update,
        unchangedCount: result.unchanged,
        skippedCount: result.skip,
        errorCount: result.error,
      },
    });
  } catch (err) {
    if (err instanceof ImportHasErrorsError) {
      await tenantDb.importJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorCount: err.count },
      });
      return;
    }
    await tenantDb.importJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    throw err;
  }
}
