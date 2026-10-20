import { TRPCError } from "@trpc/server";
import { adminDb } from "@atelieros/db";
import { OtpRateLimitError, sendOtp, verifyOtp } from "./otp-service";

// M15 §10 — export complet et suppression du compte exigent un OTP frais (< 5 min, durée de vie
// du code RG-M01-04) envoyé au demandeur lui-même (email, sinon WhatsApp).

async function destinationFor(userId: string) {
  const user = await adminDb.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, phone: true },
  });
  if (user.email) return { identifier: user.email.toLowerCase(), channel: "EMAIL" as const };
  if (user.phone) return { identifier: user.phone, channel: "WHATSAPP" as const };
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Ajoutez un email ou un téléphone à votre profil pour recevoir le code de vérification.",
  });
}

function mask(identifier: string): string {
  if (identifier.includes("@")) {
    const [local, domain] = identifier.split("@");
    return `${local!.slice(0, 2)}•••@${domain}`;
  }
  return `•••${identifier.slice(-4)}`;
}

export async function sendSensitiveActionOtp(userId: string, now: Date) {
  const { identifier, channel } = await destinationFor(userId);
  try {
    const result = await sendOtp(identifier, "SENSITIVE_ACTION", channel, now);
    return { sentVia: result.sentVia, destination: mask(identifier), devCode: result.devCode };
  } catch (error) {
    if (error instanceof OtpRateLimitError) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
    }
    throw error;
  }
}

export async function assertSensitiveActionOtp(userId: string, code: string, now: Date) {
  const { identifier } = await destinationFor(userId);
  const outcome = await verifyOtp(identifier, code, "SENSITIVE_ACTION", now);
  const messages: Record<string, string> = {
    EXPIRED: "Code expiré. Demandez-en un nouveau.",
    TOO_MANY_ATTEMPTS: "Trop de tentatives. Demandez un nouveau code.",
    INVALID_CODE: "Code incorrect.",
    NOT_FOUND: "Demandez d'abord un code de vérification.",
  };
  if (outcome !== "OK") {
    throw new TRPCError({ code: "BAD_REQUEST", message: messages[outcome] ?? "Code invalide." });
  }
}
