/**
 * File d'attente « imports » (RG-M13-24, §9 du PRD). Comme les autres
 * fournisseurs externes (CLAUDE.md : « toujours derrière une interface... une
 * implémentation console/manual pour le local et les tests »), l'enqueueur
 * est abstrait derrière `ImportJobQueue` :
 * - {@link createInlineImportJobQueue} traite le job immédiatement, dans le
 *   même process, sans dépendance à Redis — utilisée par défaut (tests,
 *   environnements sans worker séparé) ;
 * - {@link createBullmqImportJobQueue} ajoute réellement le job à la file
 *   BullMQ « imports », consommée par `apps/worker` (lots de 500,
 *   progression toutes les 2 s). C'est l'implémentation utilisée en
 *   développement/production (`IMPORT_QUEUE_DRIVER=bullmq`, voir `.env`).
 */
import type { ConnectionOptions, Queue as BullQueue } from "bullmq";
import type { ProcessImportRunJobDeps, RunImportJobData } from "./run-job";
import { processImportRunJob } from "./run-job";

export const IMPORT_QUEUE_NAME = "imports";
export const IMPORT_RUN_JOB_NAME = "run";

export type { RunImportJobData };

export interface ImportJobQueue {
  enqueueRun(data: RunImportJobData): Promise<void>;
}

/** File en mémoire : traite le job immédiatement (pas de Redis requis). Défaut pour les tests et le local sans worker. */
export function createInlineImportJobQueue(deps: ProcessImportRunJobDeps): ImportJobQueue {
  return {
    async enqueueRun(data) {
      await processImportRunJob(data, deps);
    },
  };
}

/** File BullMQ réelle (file `imports`), consommée par `apps/worker` — le routeur tRPC ne fait qu'ajouter le job. */
export function createBullmqImportJobQueue(connection: ConnectionOptions): ImportJobQueue {
  // Import différé : `bullmq`/`ioredis` ne doivent pas être instanciés (ni leur connexion
  // ouverte) tant que cette implémentation n'est pas explicitement choisie (IMPORT_QUEUE_DRIVER=bullmq).
  let queuePromise: Promise<BullQueue<RunImportJobData>> | undefined;
  async function getQueue(): Promise<BullQueue<RunImportJobData>> {
    if (!queuePromise) {
      queuePromise = import("bullmq").then(
        ({ Queue }) => new Queue<RunImportJobData>(IMPORT_QUEUE_NAME, { connection }),
      );
    }
    return queuePromise;
  }

  return {
    async enqueueRun(data) {
      const queue = await getQueue();
      // `jobId` BullMQ = `ImportJob.id` : un seul job actif par import (ré-enqueuer le
      // même `jobId` est un no-op tant qu'il n'est pas terminé, évite les doublons).
      await queue.add(IMPORT_RUN_JOB_NAME, data, { jobId: data.jobId });
    },
  };
}
