import {
  createBullmqImportJobQueue,
  createInlineImportJobQueue,
  type ImportJobQueue,
} from "@atelieros/import";
import { getObjectStorage } from "./storage";

/**
 * Sélection du pilote de file d'attente « imports » (RG-M13-24, CLAUDE.md :
 * « toujours derrière une interface... une implémentation console/manual
 * pour le local et les tests »). `inline` (défaut) traite le job
 * immédiatement, dans ce process, sans dépendance à Redis — c'est le pilote
 * utilisé par les tests d'intégration et par défaut en local tant qu'aucun
 * worker séparé n'est lancé. `bullmq` (`IMPORT_QUEUE_DRIVER=bullmq`) ajoute
 * réellement le job à la file consommée par `apps/worker`.
 */
function parseRedisConnection(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    password: parsed.password || undefined,
  };
}

const globalForQueue = globalThis as unknown as { atelierosImportQueue?: ImportJobQueue };

export function getImportJobQueue(): ImportJobQueue {
  if (!globalForQueue.atelierosImportQueue) {
    const driver = process.env.IMPORT_QUEUE_DRIVER ?? "inline";
    globalForQueue.atelierosImportQueue =
      driver === "bullmq"
        ? createBullmqImportJobQueue(
            parseRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6380"),
          )
        : createInlineImportJobQueue({ storage: getObjectStorage() });
  }
  return globalForQueue.atelierosImportQueue;
}
