import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DomainError } from "@atelieros/core";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Charge la clé maîtresse de chiffrement depuis une variable d'environnement
 * (01-architecture-technique.md §9 : `ENCRYPTION_KEY`, 32 octets en base64). Séparé de
 * `encryptSecret`/`decryptSecret` pour que ces fonctions restent pures et testables sans
 * variable d'environnement.
 */
export function loadEncryptionKey(value: string | undefined = process.env.ENCRYPTION_KEY): Buffer {
  if (!value) {
    throw new DomainError(
      "encryption.missing_key",
      "ENCRYPTION_KEY est requis pour chiffrer ou déchiffrer les identifiants fournisseurs.",
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new DomainError(
      "encryption.invalid_key_length",
      `ENCRYPTION_KEY doit faire ${KEY_LENGTH} octets une fois décodé en base64.`,
      { actualLength: key.length },
    );
  }
  return key;
}

/** Chiffre un secret fournisseur (identifiants) avec AES-256-GCM. Jamais stocké ni journalisé en clair. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString("base64")).join(".");
}

/** Déchiffre un secret produit par {@link encryptSecret}. Lève DomainError si altéré ou mal formé. */
export function decryptSecret(ciphertextEnvelope: string, key: Buffer): string {
  const parts = ciphertextEnvelope.split(".");
  if (parts.length !== 3) {
    throw new DomainError("encryption.malformed_envelope", "Secret chiffré mal formé.");
  }
  const [ivPart, authTagPart, dataPart] = parts as [string, string, string];
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(authTagPart, "base64");
  const ciphertext = Buffer.from(dataPart, "base64");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DomainError(
      "encryption.decryption_failed",
      "Impossible de déchiffrer le secret : clé incorrecte ou donnée altérée.",
    );
  }
}
