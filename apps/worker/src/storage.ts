import { createS3ObjectStorage, type S3ObjectStorage } from "@atelieros/integrations";

/**
 * Stockage objet (S3/MinIO en local) partagé par les jobs du worker. Miroir
 * de `apps/web/src/server/storage.ts` — les deux process (serveur web et
 * worker BullMQ) lisent/écrivent le même bucket.
 */
let instance: S3ObjectStorage | undefined;

export function getObjectStorage(): S3ObjectStorage {
  if (!instance) {
    instance = createS3ObjectStorage({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      bucket: process.env.S3_BUCKET ?? "atelieros-dev",
      accessKeyId: process.env.S3_ACCESS_KEY ?? "atelieros",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "atelieros123",
      // Étape 7.2 : région du fournisseur (vide = us-east-1) et adresse vue du navigateur pour
      // les URL signées quand le serveur joint S3 par le réseau interne Docker.
      region: process.env.S3_REGION || undefined,
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || undefined,
    });
  }
  return instance;
}
