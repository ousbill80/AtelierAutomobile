// RG-M01-04 — code OTP à 6 chiffres, usage unique, cadence de renvoi et plafonds d'envoi.

export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR_PER_IDENTIFIER = 5;
export const OTP_MAX_SENDS_PER_HOUR_PER_IP = 10;

/** Date d'expiration d'un OTP envoyé à `sentAt` (RG-M01-04 : valable 5 minutes). */
export function computeOtpExpiry(sentAt: Date): Date {
  return new Date(sentAt.getTime() + OTP_EXPIRY_MINUTES * 60_000);
}

export interface OtpVerificationInput {
  expiresAt: Date;
  attempts: number;
  now: Date;
}

export type OtpVerificationResult =
  { status: "OK" } | { status: "EXPIRED" } | { status: "TOO_MANY_ATTEMPTS" };

/** Vérifie qu'un code OTP peut encore être tenté (ni expiré, ni épuisé après 3 essais). */
export function checkOtpAttempt(input: OtpVerificationInput): OtpVerificationResult {
  if (input.now.getTime() > input.expiresAt.getTime()) {
    return { status: "EXPIRED" };
  }
  if (input.attempts >= OTP_MAX_ATTEMPTS) {
    return { status: "TOO_MANY_ATTEMPTS" };
  }
  return { status: "OK" };
}

/** RG-M01-04 — un nouveau code ne peut être envoyé que 60 s après le précédent. */
export function canResendOtp(lastSentAt: Date | null, now: Date): boolean {
  if (lastSentAt === null) {
    return true;
  }
  return now.getTime() - lastSentAt.getTime() >= OTP_RESEND_COOLDOWN_SECONDS * 1000;
}

/** Nombre d'envois dans l'heure glissante précédant `now`, pour un plafond (identifiant ou IP). */
export function countSendsInLastHour(sentAt: readonly Date[], now: Date): number {
  const windowStart = now.getTime() - 60 * 60_000;
  return sentAt.filter((d) => d.getTime() > windowStart).length;
}

export interface CanSendOtpInput {
  lastSentAt: Date | null;
  sentInLastHour: readonly Date[];
  now: Date;
  /** Plafond horaire : 5/h par identifiant (défaut) ou 10/h par IP (OTP_MAX_SENDS_PER_HOUR_PER_IP). */
  maxPerHour?: number;
}

/** RG-M01-04 — combine la cadence de renvoi (60 s) et le plafond horaire d'envois. */
export function canSendOtp(input: CanSendOtpInput): boolean {
  if (!canResendOtp(input.lastSentAt, input.now)) {
    return false;
  }
  const max = input.maxPerHour ?? OTP_MAX_SENDS_PER_HOUR_PER_IDENTIFIER;
  return countSendsInLastHour(input.sentInLastHour, input.now) < max;
}
