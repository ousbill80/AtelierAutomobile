import { randomInt } from "node:crypto";
import { hashPassword, LOCKOUT_FAILURE_THRESHOLD, normalizePhoneCI } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSensitiveRateLimiter } from "../security/sensitiveRateLimit";
import type { Ctx } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

const callerFactory = createCallerFactory(appRouter);
const createdUserIds: string[] = [];
const createdIdentifiers: string[] = [];
const createdOrgIds: string[] = [];

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

beforeEach(() => {
  resetSensitiveRateLimiter();
});

afterEach(async () => {
  if (createdOrgIds.length > 0) {
    await adminDb.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await adminDb.trustedDevice.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await adminDb.membership.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
    await adminDb.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
    createdOrgIds.length = 0;
  }
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
          in: createdIdentifiers.flatMap((id) => [
            `${id}:VERIFY`,
            `${id}:RESET`,
            `${id}:NEW_DEVICE`,
          ]),
        },
      },
    });
    createdIdentifiers.length = 0;
  }
});

async function createUserWithOrg(role: "OWNER" | "MECHANIC", password: string) {
  const phone = randomPhone();
  const e164Phone = normalizePhoneCI(phone).e164!;
  const passwordHash = await hashPassword(password);
  const user = await adminDb.user.create({
    data: { name: `Test ${role}`, phone: e164Phone, locale: "fr" },
  });
  createdUserIds.push(user.id);
  await adminDb.account.create({
    data: { userId: user.id, providerId: "credential", accountId: user.id, password: passwordHash },
  });
  const org = await adminDb.organization.create({ data: { name: `Garage ${role} Test` } });
  createdOrgIds.push(org.id);
  await adminDb.membership.create({
    data: { organizationId: org.id, userId: user.id, role, siteIds: [] },
  });
  await adminDb.user.update({
    where: { id: user.id },
    data: { lastActiveOrganizationId: org.id },
  });
  return { phone, orgId: org.id };
}

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

describe("authRouter — politique de mot de passe (RG-M01-03)", () => {
  it("signUp refuse un mot de passe de la liste des plus courants", async () => {
    await expect(
      callerFactory(makeCtx()).auth.signUp({
        name: "Test Policy",
        phone: randomPhone(),
        password: "password1",
        acceptTerms: true,
      }),
    ).rejects.toThrow("trop courant");
  });

  it("signUp refuse un mot de passe contenant le numéro de téléphone fourni", () => {
    const phone = randomPhone();
    return expect(
      callerFactory(makeCtx()).auth.signUp({
        name: "Test Policy",
        phone,
        password: `Secret${phone}`,
        acceptTerms: true,
      }),
    ).rejects.toThrow("numéro de téléphone");
  });
});

describe("authRouter — OTP nouvel appareil et audit (RG-M01-07 / RG-M01-15)", () => {
  it("exige un OTP sur nouvel appareil pour un OWNER puis approuve l'appareil pour 90 jours", async () => {
    const { phone, orgId } = await createUserWithOrg("OWNER", "OwnerPassword123");
    const deviceId = "device-new-owner";

    const challenge = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "OwnerPassword123",
      deviceId,
    });
    expect(challenge.status).toBe("OTP_REQUIRED");

    const otpCode = extractOtpCode(phone);
    const signInCtx = makeCtx();
    const result = await callerFactory(signInCtx).auth.signIn({
      identifier: phone,
      password: "OwnerPassword123",
      deviceId,
      otpCode,
    });
    expect(result.status).toBe("OK");
    expect(signInCtx.resHeaders.get("set-cookie")).toContain("atelieros_session=");

    const trustedDevice = await adminDb.trustedDevice.findUnique({ where: { deviceId } });
    expect(trustedDevice).not.toBeNull();
    expect(trustedDevice!.organizationId).toBe(orgId);
    expect(trustedDevice!.expiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 89 * 24 * 60 * 60 * 1000,
    );

    const auditActions = (
      await adminDb.auditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.action);
    expect(auditActions).toContain("auth.otp_new_device");
    expect(auditActions).toContain("auth.login.success");
  });

  it("autorise une connexion directe depuis un appareil déjà approuvé", async () => {
    const { phone } = await createUserWithOrg("OWNER", "OwnerPassword123");
    const deviceId = "device-trusted-owner";

    await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "OwnerPassword123",
      deviceId,
    });
    const otpCode = extractOtpCode(phone);
    await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "OwnerPassword123",
      deviceId,
      otpCode,
    });

    const secondSignIn = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "OwnerPassword123",
      deviceId,
    });
    expect(secondSignIn.status).toBe("OK");
  });

  it("n'exige pas d'OTP sur nouvel appareil pour un MECHANIC", async () => {
    const { phone } = await createUserWithOrg("MECHANIC", "MechanicPassword123");

    const result = await callerFactory(makeCtx()).auth.signIn({
      identifier: phone,
      password: "MechanicPassword123",
      deviceId: "device-new-mechanic",
    });
    expect(result.status).toBe("OK");
  });

  it("journalise auth.login.failed lors d'un mot de passe incorrect", async () => {
    const { phone, orgId } = await createUserWithOrg("OWNER", "OwnerPassword123");

    await expect(
      callerFactory(makeCtx()).auth.signIn({
        identifier: phone,
        password: "WrongPassword",
        deviceId: "device-fail-owner",
      }),
    ).rejects.toThrow("Identifiants invalides.");

    const auditLog = await adminDb.auditLog.findFirst({ where: { organizationId: orgId } });
    expect(auditLog).not.toBeNull();
    expect(auditLog!.action).toBe("auth.login.failed");
  });

  it("refuse la connexion après trop de tentatives depuis la même IP (01 §8)", async () => {
    const ctx = { ...makeCtx(), ip: "203.0.113.10" };
    for (let i = 0; i < 10; i++) {
      await expect(
        callerFactory(ctx).auth.signIn({
          identifier: "inconnu@example.ci",
          password: "WrongPassword1",
          deviceId: `device-rl-${i}`,
        }),
      ).rejects.toThrow();
    }
    await expect(
      callerFactory(ctx).auth.signIn({
        identifier: "inconnu@example.ci",
        password: "WrongPassword1",
        deviceId: "device-rl-blocked",
      }),
    ).rejects.toThrow(/Trop de tentatives/);
  });
});
