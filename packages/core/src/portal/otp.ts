// M14 RG-M14-22 — accès « Mon espace » par OTP téléphone : 6 chiffres, 5 min, 5 essais,
// 3 envois par heure et par numéro ; session de 30 jours.

export const PORTAL_OTP_LENGTH = 6;
export const PORTAL_OTP_TTL_MS = 5 * 60_000;
export const PORTAL_OTP_MAX_ATTEMPTS = 5;
export const PORTAL_OTP_MAX_SENDS_PER_HOUR = 3;
export const PORTAL_SESSION_DAYS = 30;

/** Code à 6 chiffres à partir d'un entier aléatoire fourni par l'appelant. */
export function portalOtpFromRandom(n: number): string {
  return String(Math.abs(Math.trunc(n)) % 10 ** PORTAL_OTP_LENGTH).padStart(PORTAL_OTP_LENGTH, "0");
}

export function isPortalOtpShape(code: string): boolean {
  return new RegExp(`^\\d{${PORTAL_OTP_LENGTH}}$`).test(code);
}

export function canSendPortalOtp(sentLastHour: number): boolean {
  return sentLastHour < PORTAL_OTP_MAX_SENDS_PER_HOUR;
}

export type PortalOtpCheck = "OK" | "INVALID" | "EXPIRED" | "LOCKED" | "CONSUMED";

/** Vérifie un défi OTP (le hachage du code est comparé par l'appelant : `matches`). */
export function checkPortalOtp(
  challenge: { expiresAt: Date; attempts: number; consumedAt: Date | null },
  matches: boolean,
  now: Date,
): PortalOtpCheck {
  if (challenge.consumedAt) return "CONSUMED";
  if (challenge.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (challenge.attempts >= PORTAL_OTP_MAX_ATTEMPTS) return "LOCKED";
  return matches ? "OK" : "INVALID";
}

/** Message identique que le numéro soit connu ou non (US-M14-08). */
export const PORTAL_OTP_NEUTRAL_MESSAGE =
  "Si ce numéro est enregistré, vous allez recevoir un code.";

export function portalOtpMessage(garageName: string, code: string): string {
  return `${garageName} : votre code d'accès est ${code}. Il est valable 5 minutes. Ne le communiquez à personne.`;
}

export function portalSessionExpiry(now: Date): Date {
  return new Date(now.getTime() + PORTAL_SESSION_DAYS * 86_400_000);
}
