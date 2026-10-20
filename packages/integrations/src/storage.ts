import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DomainError } from "@atelieros/core";

/**
 * Types MIME acceptés en upload (photos d'atelier, pièces jointes de devis/
 * factures, et — M13 — rapports d'erreurs/modèles CSV générés par le
 * serveur pour l'import fichier).
 */
const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/csv",
  // M15 RG-M15-21 — archive de l'export complet (générée par le serveur, jamais téléversée).
  "application/zip",
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
    /**
     * Client utilisé pour signer les URL remises au navigateur. Distinct de `client` quand le
     * serveur joint le stockage par une adresse interne (réseau Docker) que le navigateur ne
     * connaît pas (étape 7.2, `S3_PUBLIC_ENDPOINT`). Par défaut, le même client.
     */
    private readonly presignClient: S3Client = client,
  ) {}

  /** Sonde de santé (`/api/health`) : le bucket existe et les identifiants sont acceptés. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

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

  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds = 300,
    /** Si fourni, le navigateur télécharge le fichier sous ce nom (Content-Disposition). */
    downloadFileName?: string,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadFileName
        ? `attachment; filename="${downloadFileName.replace(/"/g, "")}"`
        : undefined,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  /**
   * URL signée pour un upload direct par le client (PUT), sans passer le
   * fichier par le serveur applicatif. Le contrôle de type/taille (RG-M13-01)
   * reste à la charge de l'appelant : cette méthode ne fait aucune hypothèse
   * sur l'usage (photos, imports…).
   */
  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: expiresInSeconds });
  }

  async getObjectBytes(key: string): Promise<Uint8Array> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) {
      throw new DomainError("storage.object_not_found", `Objet introuvable : « ${key} ».`, { key });
    }
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return bytes;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export interface S3ObjectStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
  /** Adresse du stockage vue du navigateur, pour les URL signées ; vide = `endpoint`. */
  publicEndpoint?: string;
}

/**
 * Construit un `S3ObjectStorage` à partir de la configuration (S3/MinIO en
 * local). Évite que les apps/worker dépendent directement de `@aws-sdk/*`.
 */
export function createS3ObjectStorage(config: S3ObjectStorageConfig): S3ObjectStorage {
  const clientFor = (endpoint: string) =>
    new S3Client({
      region: config.region ?? "us-east-1",
      endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  const client = clientFor(config.endpoint);
  const presignClient =
    config.publicEndpoint && config.publicEndpoint !== config.endpoint
      ? clientFor(config.publicEndpoint)
      : client;
  return new S3ObjectStorage(client, config.bucket, presignClient);
}
