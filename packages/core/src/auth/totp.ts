// Application d'authentification (TOTP, RFC 6238) — alternative à l'OTP « nouvel appareil »
// envoyé par email/WhatsApp/SMS (RG-M01-07). Compatible Google Authenticator, Microsoft
// Authenticator, Authy… : HMAC-SHA1, 6 chiffres, pas de 30 s.
import { createHmac } from "node:crypto";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Tolérance de décalage d'horloge : ±1 pas (30 s) autour de l'instant courant. */
export const TOTP_WINDOW_STEPS = 1;
/** 20 octets = 160 bits, taille recommandée pour HMAC-SHA1 (RFC 4226 §4). */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ISSUER = "AtelierOS";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode des octets en base32 (RFC 4648), sans remplissage — format attendu par les applis. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Décode du base32 (insensible à la casse, espaces et `=` ignorés). Lève si caractère invalide. */
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Caractère base32 invalide : ${char}`);
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

/** Crée un secret base32 à partir d'octets aléatoires fournis par l'appelant (testable). */
export function createTotpSecret(randomBytes: Uint8Array): string {
  if (randomBytes.length < TOTP_SECRET_BYTES) {
    throw new Error(`Le secret TOTP doit faire au moins ${TOTP_SECRET_BYTES} octets.`);
  }
  return base32Encode(randomBytes);
}

/** Numéro de pas TOTP (fenêtre de 30 s) pour un instant donné. */
export function totpStep(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

/** Code HOTP (RFC 4226) pour un compteur — base du TOTP. */
export function hotpCode(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

/** Code TOTP attendu à l'instant `now` pour un secret base32. */
export function totpCode(secretBase32: string, now: Date): string {
  return hotpCode(base32Decode(secretBase32), totpStep(now));
}

export type TotpVerificationResult =
  { status: "OK"; step: number } | { status: "INVALID_CODE" } | { status: "ALREADY_USED" };

export interface VerifyTotpInput {
  secretBase32: string;
  code: string;
  now: Date;
  /** Dernier pas accepté pour ce compte : un code déjà utilisé (ou plus ancien) est refusé. */
  lastUsedStep?: number | null;
}

/**
 * Vérifie un code TOTP avec une tolérance de ±1 pas et une protection contre le rejeu :
 * un pas déjà accepté (ou antérieur) ne peut pas resservir.
 */
export function verifyTotp(input: VerifyTotpInput): TotpVerificationResult {
  const code = input.code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) {
    return { status: "INVALID_CODE" };
  }
  const secret = base32Decode(input.secretBase32);
  const current = totpStep(input.now);
  for (let delta = -TOTP_WINDOW_STEPS; delta <= TOTP_WINDOW_STEPS; delta += 1) {
    const step = current + delta;
    if (hotpCode(secret, step) !== code) continue;
    if (input.lastUsedStep !== null && input.lastUsedStep !== undefined) {
      if (step <= input.lastUsedStep) return { status: "ALREADY_USED" };
    }
    return { status: "OK", step };
  }
  return { status: "INVALID_CODE" };
}

/** Lien `otpauth://` encodé dans le QR code scanné par l'application. */
export function buildTotpUri(input: { secretBase32: string; accountLabel: string }): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${input.accountLabel}`);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
