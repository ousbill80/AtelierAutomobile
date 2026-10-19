import path from "node:path";
import {
  createS3ObjectStorage,
  LocalObjectStorage,
  type BinaryObjectStorage,
  type S3ObjectStorage,
} from "@atelieros/integrations";

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

const globalForAttachments = globalThis as unknown as {
  atelierosAttachmentStorage?: BinaryObjectStorage;
};

/**
 * Stockage des pièces jointes d'OR (photos, signatures — M04). `STORAGE_DRIVER=local` écrit
 * sur disque (`LOCAL_STORAGE_DIR`, défaut `.data/uploads`) pour travailler sans MinIO ; sinon
 * S3/MinIO comme le reste de l'application.
 */
export function getAttachmentStorage(): BinaryObjectStorage {
  if (!globalForAttachments.atelierosAttachmentStorage) {
    globalForAttachments.atelierosAttachmentStorage =
      process.env.STORAGE_DRIVER === "local"
        ? new LocalObjectStorage(
            process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".data", "uploads"),
          )
        : getObjectStorage();
  }
  return globalForAttachments.atelierosAttachmentStorage;
}
