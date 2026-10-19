// M13 §9 — `imports.watch` et `sync.run` (partie 2, étape 6.4). Le watch ne fait que
// repérer les sources `SQL_DATABASE` actives dont le planning est échu (RG-M13-27) ;
// l'exécution (requêtes en lecture seule puis pipeline d'import) vit dans
// `@atelieros/import` (`runSqlSync`).
import { isSyncDue } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { runSqlSync, type RunSqlSyncInput } from "@atelieros/import";
import { loadEncryptionKey } from "@atelieros/integrations";
import { logger } from "../logger";
import type { SyncRunJobData } from "../queues/sync";

export class SyncRunFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncRunFailedError";
  }
}

/** Repère les sources dues et renvoie les synchros à lancer (clé = échéance, pour le jobId). */
export async function findDueSqlSources(
  now: Date,
): Promise<{ data: SyncRunJobData; runKey: string }[]> {
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true },
  });
  const due: { data: SyncRunJobData; runKey: string }[] = [];
  for (const org of organizations) {
    const sources = await db.forTenant({ organizationId: org.id }).dataSource.findMany({
      where: { type: "SQL_DATABASE", isActive: true },
      select: { id: true, schedule: true, lastRunAt: true, createdAt: true },
    });
    for (const source of sources) {
      try {
        const reference = source.lastRunAt ?? source.createdAt;
        if (isSyncDue(source.schedule, reference, now, org.timezone)) {
          due.push({
            data: { organizationId: org.id, dataSourceId: source.id },
            runKey: String(Math.floor(now.getTime() / (15 * 60_000))),
          });
        }
      } catch (error) {
        logger.warn(
          { dataSourceId: source.id, error: error instanceof Error ? error.message : error },
          "imports.watch : planning illisible, source ignorée",
        );
      }
    }
  }
  return due;
}

/** Exécute une synchro ; lève en cas d'échec pour que BullMQ applique les relances (RG-M13-27). */
export async function processSyncRunJob(
  data: SyncRunJobData,
  deps: Pick<RunSqlSyncInput, "createDb"> & { now?: () => Date } = {},
): Promise<void> {
  const result = await runSqlSync({
    organizationId: data.organizationId,
    dataSourceId: data.dataSourceId,
    encryptionKey: loadEncryptionKey(),
    now: deps.now ? deps.now() : new Date(),
    createDb: deps.createDb,
  });
  logger.info(
    { dataSourceId: data.dataSourceId, status: result.status, entities: result.entities },
    "sync.run terminé",
  );
  if (result.status === "FAILED") throw new SyncRunFailedError(result.error ?? "Synchro en échec");
}
