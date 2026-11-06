import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { adminDb } from "@atelieros/db";
import {
  canSendOtp,
  checkOtpAttempt,
  computeOtpExpiry,
  OTP_CODE_LENGTH,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "@atelieros/core";
import {
  createConsoleMessagingProvider,
  PlatformOtpDeliveryError,
  platformOtpChannels,
  readPlatformMessagingConfig,
  sendPlatformOtp,
  type MessageChannel,
  type PlatformMessagingConfig,
} from "@atelieros/integrations";
import type { OtpPurpose as PublicOtpPurpose } from "@atelieros/validators";

/**
 * `SENSITIVE_ACTION` (M15 §10) : OTP frais (< 5 min) exigé pour l'export complet et la
 * suppression du compte. Volontairement absent du schéma public `auth.sendOtp`.
 */
type OtpPurpose = PublicOtpPurpose | "SENSITIVE_ACTION";

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
  /** Code en clair, uniquement en développement, pour fluidifier les tests locaux. */
  devCode?: string;
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

  const body = `AtelierOS : votre code est ${code}. Il expire dans 5 minutes. Ne le communiquez à personne.`;
  let sentVia: MessageChannel;
  try {
    sentVia = await deliverOtp({
      to: identifier,
      requestedChannel: channel,
      code,
      body,
      subject: `Votre code AtelierOS : ${code}`,
      templateKey: `otp.${purpose.toLowerCase()}`,
      idempotencyKey: `otp:${key}:${now.getTime()}`,
    });
  } catch (error) {
    // Code non parti : on l'efface pour ne compter ni la cadence ni la limite horaire.
    await adminDb.verification.deleteMany({ where: { identifier: key, value: hashCode(code) } });
    throw error;
  }

  return {
    sentVia,
    retryAfterSec: OTP_RESEND_COOLDOWN_SECONDS,
    devCode: process.env.NODE_ENV === "development" ? code : undefined,
  };
}

/**
 * Erreur d'envoi d'un OTP montrée telle quelle à l'utilisateur (RG-M01-04, cas limite « aucun
 * réseau SMS ») : « Envoi du code impossible pour le moment. Réessayez dans quelques minutes. »
 */
export { PlatformOtpDeliveryError as OtpDeliveryError };

function isProduction(): boolean {
  return process.env.APP_ENV === "production";
}

function platformConfig(): PlatformMessagingConfig {
  return readPlatformMessagingConfig(process.env);
}

/**
 * Vrai si un code peut partir sur ce canal. Hors production, le fournisseur `console` prend le
 * relais (CLAUDE.md : jamais de compte réel exigé pour tourner) ; en production, il faut un
 * canal plateforme configuré (M01 §14). Vérifié avant de créer un compte, pour ne pas laisser
 * un compte impossible à valider.
 */
export function canDeliverOtp(channel: MessageChannel): boolean {
  if (!isProduction()) return true;
  try {
    return platformOtpChannels(platformConfig(), channel).length > 0;
  } catch {
    return false;
  }
}

async function reportDeliveryFailure(error: unknown): Promise<void> {
  const attempted = error instanceof PlatformOtpDeliveryError ? error.attempted : [];
  const reason =
    error instanceof PlatformOtpDeliveryError
      ? attempted.length === 0
        ? "aucun canal plateforme configuré (PLATFORM_WHATSAPP_*, PLATFORM_SMS_*, PLATFORM_EMAIL_*)"
        : `échec sur ${attempted.join(" puis ")}`
      : error instanceof Error
        ? error.message
        : "erreur inconnue";
  // Ni le code ni le destinataire dans le journal.
  console.error(`[auth:otp] envoi impossible : ${reason}`);
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(`OTP : envoi impossible (${reason})`, "fatal");
  } catch {
    // Sentry indisponible : le journal suffit.
  }
}

async function deliverOtp(input: {
  to: string;
  requestedChannel: MessageChannel;
  code: string;
  body: string;
  subject: string;
  templateKey: string;
  idempotencyKey: string;
}): Promise<MessageChannel> {
  let config: PlatformMessagingConfig;
  try {
    config = platformConfig();
  } catch (error) {
    if (!isProduction()) config = {};
    else {
      await reportDeliveryFailure(error);
      throw new PlatformOtpDeliveryError([]);
    }
  }

  // Hors production, sans canal plateforme pour ce destinataire : fournisseur console.
  if (!isProduction() && platformOtpChannels(config, input.requestedChannel).length === 0) {
    const provider = createConsoleMessagingProvider(input.requestedChannel);
    await provider.send({
      to: input.to,
      channel: input.requestedChannel,
      body: input.body,
      subject: input.subject,
      templateKey: input.templateKey,
      idempotencyKey: input.idempotencyKey,
    });
    return input.requestedChannel;
  }

  try {
    const { sentVia } = await sendPlatformOtp(config, input);
    return sentVia;
  } catch (error) {
    await reportDeliveryFailure(error);
    throw error instanceof PlatformOtpDeliveryError ? error : new PlatformOtpDeliveryError([]);
  }
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
