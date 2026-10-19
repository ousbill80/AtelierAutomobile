import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { adminDb } from "@atelieros/db";
import {
  canSendOtp,
  checkOtpAttempt,
  computeOtpExpiry,
  OTP_CODE_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "@atelieros/core";
import { createConsoleMessagingProvider, type MessageChannel } from "@atelieros/integrations";
import type { OtpPurpose } from "@atelieros/validators";

function verificationKey(identifier: string, purpose: OtpPurpose): string {
  return `${identifier}:${purpose}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, "0");
}

export class OtpRateLimitError extends Error {
  constructor() {
    super("Veuillez patienter avant de redemander un code.");
    this.name = "OtpRateLimitError";
  }
}

export interface SendOtpResult {
  sentVia: MessageChannel;
  retryAfterSec: number;
}

/** RG-M01-04 : envoie un OTP à 6 chiffres (5 min, 3 essais, cadence 60 s / 5 par heure). */
export async function sendOtp(
  identifier: string,
  purpose: OtpPurpose,
  channel: MessageChannel,
  now: Date,
): Promise<SendOtpResult> {
  const key = verificationKey(identifier, purpose);
  const recent = await adminDb.verification.findMany({
    where: { identifier: key },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const lastSentAt = recent[0]?.createdAt ?? null;
  if (
    !canSendOtp({
      lastSentAt,
      sentInLastHour: recent.map((r) => r.createdAt),
      now,
    })
  ) {
    throw new OtpRateLimitError();
  }

  const code = generateOtpCode();
  await adminDb.verification.create({
    data: {
      identifier: key,
      value: hashCode(code),
      attempts: 0,
      expiresAt: computeOtpExpiry(now),
    },
  });

  const provider = createConsoleMessagingProvider(channel);
  await provider.send({
    to: identifier,
    channel,
    body: `AtelierOS : votre code est ${code}. Il expire dans 5 minutes.`,
    templateKey: `otp.${purpose.toLowerCase()}`,
    idempotencyKey: `otp:${key}:${now.getTime()}`,
  });

  return { sentVia: channel, retryAfterSec: OTP_RESEND_COOLDOWN_SECONDS };
}

export type VerifyOtpOutcome =
  "OK" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "INVALID_CODE" | "NOT_FOUND";

/** RG-M01-04 : vérifie un code OTP (expiration, essais, comparaison en temps constant). */
export async function verifyOtp(
  identifier: string,
  code: string,
  purpose: OtpPurpose,
  now: Date,
): Promise<VerifyOtpOutcome> {
  const key = verificationKey(identifier, purpose);
  const row = await adminDb.verification.findFirst({
    where: { identifier: key },
    orderBy: { createdAt: "desc" },
  });
  if (!row) {
    return "NOT_FOUND";
  }

  const attemptCheck = checkOtpAttempt({ expiresAt: row.expiresAt, attempts: row.attempts, now });
  if (attemptCheck.status !== "OK") {
    return attemptCheck.status;
  }

  const expected = Buffer.from(hashCode(code), "hex");
  const actual = Buffer.from(row.value, "hex");
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    await adminDb.verification.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return "INVALID_CODE";
  }

  await adminDb.verification.delete({ where: { id: row.id } });
  return "OK";
}

export function hashResetToken(token: string): string {
  return hashCode(token);
}
