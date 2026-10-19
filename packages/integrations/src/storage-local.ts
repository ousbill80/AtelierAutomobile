import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@atelieros/core";
import { assertUploadable, type UploadInput } from "./storage";

/**
 * Contrat minimal de stockage binaire (photos et signatures d'OR, M04) : implémenté par
 * `S3ObjectStorage` (S3/MinIO) et `LocalObjectStorage` (disque, sans compte ni service tiers :
 * développement et tests, CLAUDE.md « Fournisseurs externes »).
 */
export interface BinaryObjectStorage {
  upload(input: UploadInput): Promise<{ key: string }>;
  getObjectBytes(key: string): Promise<Uint8Array>;
}

/** Stockage sur disque local, sous `root`. Les clés ne peuvent pas sortir de `root`. */
export class LocalObjectStorage implements BinaryObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) {
      throw new DomainError("storage.invalid_key", `Clé de stockage invalide : « ${key} ».`, {
        key,
      });
    }
    return target;
  }

  async upload(input: UploadInput): Promise<{ key: string }> {
    assertUploadable(input);
    const target = this.resolve(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return { key: input.key };
  }

  async getObjectBytes(key: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.resolve(key)));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("storage.object_not_found", `Objet introuvable : « ${key} ».`, {
        key,
      });
    }
  }
}
