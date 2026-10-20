// Producteur de la file BullMQ « fne » (M08 §9) : `fne.certify` ajouté après le commit de
// l'émission d'une facture ou d'un avoir en mode `api`. Les noms doivent rester identiques à
// `apps/worker/src/queues/fne.ts`, qui la consomme.
import { Queue } from "bullmq";
import IORedis from "ioredis";

export const FNE_QUEUE_NAME = "fne";
export const FNE_CERTIFY_JOB_NAME = "fne.certify";

let redisConnection: IORedis | undefined;
let fneQueue: Queue | undefined;

function getFneQueue(): Queue | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  redisConnection ??= new IORedis(url, { maxRetriesPerRequest: null });
  fneQueue ??= new Queue(FNE_QUEUE_NAME, { connection: redisConnection });
  return fneQueue;
}

/**
 * Best effort : sans Redis, la facture reste PENDING avec `fneNextRetryAt = issuedAt` et le
 * balayage `fne.retry` (10 min) la soumet. `jobId` par tentative : un double clic ne double pas
 * l'appel, et la réservation `fneAttempts` (certifyInvoiceFne) garantit l'idempotence.
 */
export async function enqueueFneCertifyJob(
  organizationId: string,
  invoiceId: string,
  attempt: number,
): Promise<void> {
  try {
    const queue = getFneQueue();
    if (!queue) return;
    // Redis injoignable : ne pas bloquer la réponse de l'émission (ioredis met les commandes en attente).
    await Promise.race([
      queue.add(
        FNE_CERTIFY_JOB_NAME,
        { organizationId, invoiceId },
        {
          jobId: `fne-certify:${invoiceId}:${attempt}`,
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      ),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  } catch {
    // Redis indisponible : repris par `fne.retry`.
  }
}
