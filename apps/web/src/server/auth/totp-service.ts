import { randomBytes } from "node:crypto";
import { createTotpSecret, TOTP_SECRET_BYTES, verifyTotp } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { decryptSecret, encryptSecret, loadEncryptionKey } from "@atelieros/integrations";

/** Nouveau secret TOTP base32 (160 bits aléatoires). */
export function generateTotpSecret(): string {
  return createTotpSecret(randomBytes(TOTP_SECRET_BYTES));
}

/** Le secret n'est jamais stocké en clair : AES-256-GCM avec ENCRYPTION_KEY. */
export function sealTotpSecret(secretBase32: string): string {
  return encryptSecret(secretBase32, loadEncryptionKey());
}

export function openTotpSecret(sealed: string): string {
  return decryptSecret(sealed, loadEncryptionKey());
}

export interface TotpUserState {
  id: string;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastUsedStep: number | null;
}

/** Application d'authentification active : secret présent ET activation confirmée par un code. */
export function hasTotpEnabled(user: TotpUserState): boolean {
  return user.totpSecret !== null && user.totpEnabledAt !== null;
}

/**
 * Vérifie un code de l'application et, s'il est bon, mémorise son pas (anti-rejeu).
 * Retourne `false` pour un code faux, déjà utilisé ou un compte sans secret.
 */
export async function checkAndConsumeTotp(
  user: TotpUserState,
  code: string,
  now: Date,
): Promise<boolean> {
  if (!user.totpSecret) return false;
  const result = verifyTotp({
    secretBase32: openTotpSecret(user.totpSecret),
    code,
    now,
    lastUsedStep: user.totpLastUsedStep,
  });
  if (result.status !== "OK") return false;
  // Mise à jour conditionnelle : deux requêtes simultanées avec le même code → une seule passe.
  const updated = await adminDb.user.updateMany({
    where: {
      id: user.id,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: result.step } }],
    },
    data: { totpLastUsedStep: result.step },
  });
  return updated.count === 1;
}
