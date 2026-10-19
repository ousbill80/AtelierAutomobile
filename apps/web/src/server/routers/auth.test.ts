import { randomInt } from "node:crypto";
import { LOCKOUT_FAILURE_THRESHOLD, normalizePhoneCI } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { afterEach, describe, expect, it } from "vitest";
import type { Ctx } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);
const createdUserIds: string[] = [];
const createdIdentifiers: string[] = [];

function makeCtx(): Ctx {
  return {
    resHeaders: new Headers(),
    user: null,
    session: null,
    membership: null,
    permissions: new Set(),
    allowedSiteIds: [],
    ip: "127.0.0.1",
    userAgent: "vitest",
  };
}

function randomPhone(): string {
  const phone = `07${randomInt(0, 10 ** 8)
    .toString()
    .padStart(8, "0")}`;
  createdIdentifiers.push(normalizePhoneCI(phone).e164!);
  return phone;
}

function extractOtpCode(identifier: string): string {
  const e164 = normalizePhoneCI(identifier).e164!;
  const body = defaultOutbox.lastFor(e164)?.body;
  const match = body?.match(/code est (\d{6})/);
  if (!match) throw new Error(`Aucun OTP trouvé pour ${identifier}`);
  return match[1]!;
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await adminDb.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await adminDb.account.deleteMany({ where: { accountId: { in: createdUserIds } } });
    await adminDb.verification.deleteMany({
      where: { identifier: { in: createdUserIds.map((id) => `RESET_TOKEN:${id}`) } },
    });
    await adminDb.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
  if (createdIdentifiers.length > 0) {
    await adminDb.verification.deleteMany({
      where: {
        identifier: {
          in: createdIdentifiers.flatMap((id) => [`${id}:VERIFY`, `${id}:RESET`]),
        },
      },
    });
    createdIdentifiers.length = 0;
  }
});

describe("authRouter — parcours inscription / connexion (M01)", () => {
  it("signUp → verifyOtp(VERIFY) → signIn réussit", async () => {
    const phone = randomPhone();
    const caller = callerFactory(makeCtx());

    const signUpResult = await caller.auth.signUp({
      name: "Test Utilisateur",
      phone,
      password: "SuperSecret123",
      acceptTerms: true,
    });
    createdUserIds.push(signUpResult.userId);
    expect(signUpResult.otpChannel).toBe("WHATSAPP");

    const code = extractOtpCode(phone);
    const verifyResult = await caller.auth.verifyOtp({
      identifier: phone,
      code,
      purpose: "VERIFY",
    });
    expect(verifyResult.ok).toBe(true);

    const user = await adminDb.user.findUniqueOrThrow({ where: { id: signUpResult.userId } });
    expect(user.phoneVerifiedAt).not.toBeNull();

    const signInCtx = makeCtx();
    const signInCaller = callerFactory(signInCtx);
    const signInResult = await signInCaller.auth.signIn({
      identifier: phone,
      password: "SuperSecret123",
      deviceId: "device-1",
    });
    expect(signInResult.status).toBe("OK");
    expect(signInCtx.resHeaders.get("set-cookie")).toContain("atelieros_session=");

    const session = await adminDb.session.findFirst({ where: { userId: signUpResult.userId } });
    expect(session).not.toBeNull();
  });

  it("verrouille après 5 échecs puis déverrouille par réinitialisation OTP (E2E scénario 4)", async () => {
    const phone = randomPhone();
    const caller = callerFactory(makeCtx());

    const signUpResult = await caller.auth.signUp({
      name: "Test Verrou",
      phone,
      password: "CorrectHorse123",
      acceptTerms: true,
    });
    createdUserIds.push(signUpResult.userId);

    for (let i = 0; i < LOCKOUT_FAILURE_THRESHOLD - 1; i++) {
      await expect(
        callerFactory(makeCtx()).auth.signIn({
          identifier: phone,
          password: "WrongPassword",
          deviceId: "device-1",
        }),
      ).rejects.toThrow("Identifiants invalides.");
    }

    const lockingAttempt = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "WrongPassword",
      deviceId: "device-1",
    });
    expect(lockingAttempt.status).toBe("LOCKED");

    const lockedEvenWithCorrectPassword = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "CorrectHorse123",
      deviceId: "device-1",
    });
    expect(lockedEvenWithCorrectPassword.status).toBe("LOCKED");

    await callerFactory(makeCtx()).auth.sendOtp({ identifier: phone, purpose: "RESET" });
    const resetCode = extractOtpCode(phone);
    const verifyResetResult = await callerFactory(makeCtx()).auth.verifyOtp({
      identifier: phone,
      code: resetCode,
      purpose: "RESET",
    });
    if (!verifyResetResult.resetToken) {
      throw new Error("resetToken manquant dans la réponse verifyOtp(RESET)");
    }
    const resetToken = verifyResetResult.resetToken;

    await callerFactory(makeCtx()).auth.resetPassword({
      resetToken,
      newPassword: "BrandNewPassword456",
    });

    const finalSignIn = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "BrandNewPassword456",
      deviceId: "device-1",
    });
    expect(finalSignIn.status).toBe("OK");

    const refreshedUser = await adminDb.user.findUniqueOrThrow({
      where: { id: signUpResult.userId },
    });
    expect(refreshedUser.lockedUntil).toBeNull();
    expect(refreshedUser.failedLoginCount).toBe(0);
  });

  it("signIn échoue avec UNAUTHORIZED pour un identifiant inconnu", async () => {
    await expect(
      callerFactory(makeCtx()).auth.signIn({
        identifier: randomPhone(),
        password: "whatever123",
        deviceId: "device-1",
      }),
    ).rejects.toThrow("Identifiants invalides.");
  });
});
