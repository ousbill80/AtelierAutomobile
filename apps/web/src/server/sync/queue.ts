import { runSqlSync } from "@atelieros/import";
import { loadEncryptionKey } from "@atelieros/integrations";
import { Queue } from "bullmq";

/**
 * « Synchroniser maintenant » (M13 §8 `dataSources.runNow`). Même choix de pilote que la file
 * d'import (`IMPORT_QUEUE_DRIVER`) : `inline` (défaut local et tests) exécute la synchro dans
 * ce process ; `bullmq` ajoute un `sync.run` à la file consommée par apps/worker
 * (doit correspondre à apps/worker/src/queues/sync.ts).
 */
export interface SyncRunner {
  run(data: { organizationId: string; dataSourceId: string }): Promise<{ queued: boolean }>;
}

function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
  };
}

const globalForSync = globalThis as unknown as { atelierosSyncRunner?: SyncRunner };

export function getSyncRunner(): SyncRunner {
  if (!globalForSync.atelierosSyncRunner) {
    if ((process.env.IMPORT_QUEUE_DRIVER ?? "inline") === "bullmq") {
      const queue = new Queue("sync", {
        connection: redisConnection(process.env.REDIS_URL ?? "redis://localhost:6380"),
      });
      globalForSync.atelierosSyncRunner = {
        run: async (data) => {
          await queue.add("sync.run", data, {
            jobId: `sync-${data.dataSourceId}-manual-${Date.now()}`,
            attempts: 1,
          });
          return { queued: true };
        },
      };
    } else {
      globalForSync.atelierosSyncRunner = {
        run: async (data) => {
          await runSqlSync({ ...data, encryptionKey: loadEncryptionKey(), now: new Date() });
          return { queued: false };
        },
      };
    }
  }
  return globalForSync.atelierosSyncRunner;
}
