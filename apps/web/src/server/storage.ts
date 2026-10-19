import { createS3ObjectStorage, type S3ObjectStorage } from "@atelieros/integrations";

/**
 * Stockage objet (S3/MinIO en local) partagé par les routeurs tRPC. Les
 * identifiants viennent de l'environnement (jamais exigé de compte réel en
 * local : MinIO tourne dans `docker/docker-compose.yml`).
 */
const globalForStorage = globalThis as unknown as { atelierosObjectStorage?: S3ObjectStorage };

export function getObjectStorage(): S3ObjectStorage {
  if (!globalForStorage.atelierosObjectStorage) {
    globalForStorage.atelierosObjectStorage = createS3ObjectStorage({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      bucket: process.env.S3_BUCKET ?? "atelieros-dev",
      accessKeyId: process.env.S3_ACCESS_KEY ?? "atelieros",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "atelieros123",
    });
  }
  return globalForStorage.atelierosObjectStorage;
}
