import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DomainError } from "@atelieros/core";

/** Types MIME acceptés en upload (photos d'atelier, pièces jointes de devis/factures). */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface UploadInput {
  key: string;
  body: Uint8Array;
  contentType: string;
  maxBytes?: number;
}

/** Contrôle du type MIME et de la taille (01-architecture-technique.md §8/§11), avant tout appel réseau. */
export function assertUploadable(input: UploadInput): void {
  if (!ALLOWED_MIME_TYPES.has(input.contentType)) {
    throw new DomainError(
      "storage.unsupported_mime_type",
      `Type de fichier non supporté : « ${input.contentType} ».`,
      { contentType: input.contentType },
    );
  }
  const limit = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (input.body.byteLength > limit) {
    throw new DomainError(
      "storage.file_too_large",
      `Fichier trop volumineux (${input.body.byteLength} octets, limite ${limit}).`,
      { size: input.body.byteLength, limit },
    );
  }
}

/** Adaptateur de stockage S3/MinIO : upload contrôlé et URL signées à durée courte. */
export class S3ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async upload(input: UploadInput): Promise<{ key: string }> {
    assertUploadable(input);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
