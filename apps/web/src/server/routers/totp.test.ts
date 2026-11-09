import { randomBytes, randomInt } from "node:crypto";
import { hashPassword, normalizePhoneCI, totpCode } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { defaultOutbox } from "@atelieros/integrations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSensitiveRateLimiter } from "../security/sensitiveRateLimit";
import type { Ctx } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./_app";

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const callerFactory = createCallerFactory(appRouter);
const PASSWORD = "TotpTest-Horse42";
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];
const createdIdentifiers: string[] = [];

function anonymousCtx(): Ctx {
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

interface TestAccount {
  userId: string;
  orgId: string;
  membershipId: string;
  phone: string;
}

async function createAccount(role: "OWNER" | "MECHANIC"): Promise<TestAccount> {
  const phone = `07${randomInt(0, 10 ** 8)
    .toString()
    .padStart(8, "0")}`;
  const e164 = normalizePhoneCI(phone).e164!;
  createdIdentifiers.push(e164);
  const user = await adminDb.user.create({
    data: { name: `Totp ${role}`, phone: e164, phoneVerifiedAt: new Date(), locale: "fr" },
  });
  createdUserIds.push(user.id);
  await adminDb.account.create({
    data: {
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await hashPassword(PASSWORD),
    },
  });
  const org = await adminDb.organization.create({ data: { name: `Garage Totp ${role}` } });
  createdOrgIds.push(org.id);
  const membership = await adminDb.membership.create({
    data: { organizationId: org.id, userId: user.id, role, siteIds: [] },
  });
  await adminDb.user.update({
    where: { id: user.id },
    data: { lastActiveOrganizationId: org.id },
  });
  return { userId: user.id, orgId: org.id, membershipId: membership.id, phone };
}

function authedCtx(account: TestAccount): Ctx {
  return {
    ...anonymousCtx(),
    user: { id: account.userId, name: "Totp" },
    session: {
      id: `session-${account.userId}`,
      token: "test",
      activeOrganizationId: account.orgId,
      activeSiteId: null,
      isPinSession: false,
    },
    membership: { id: account.membershipId, role: "OWNER", siteIds: [] },
  };
}

/** Active l'appli pour le compte et renvoie le secret base32 (ce que l'appli du téléphone garde). */
async function enableTotp(account: TestAccount): Promise<string> {
  const caller = callerFactory(authedCtx(account));
  const { secret } = await caller.totp.setup({ password: PASSWORD });
  await caller.totp.enable({ code: totpCode(secret, new Date()) });
  return secret;
}

beforeEach(() => {
  resetSensitiveRateLimiter();
});

afterEach(async () => {
  await adminDb.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await adminDb.trustedDevice.deleteMany({ where: { userId: { in: createdUserIds } } });
  await adminDb.membership.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await adminDb.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await adminDb.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await adminDb.account.deleteMany({ where: { accountId: { in: createdUserIds } } });
  await adminDb.verification.deleteMany({
    where: {
      identifier: {
        in: [
          ...createdUserIds.map((id) => `RESET_TOKEN:${id}`),
          ...createdIdentifiers.flatMap((id) => [`${id}:RESET`, `${id}:NEW_DEVICE`]),
        ],
      },
    },
  });
  await adminDb.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
  createdOrgIds.length = 0;
  createdIdentifiers.length = 0;
});

describe("totpRouter — configuration de l'application d'authentification", () => {
  it("refuse la configuration avec un mauvais mot de passe", async () => {
    const account = await createAccount("OWNER");
    await expect(
      callerFactory(authedCtx(account)).totp.setup({ password: "pas-le-bon" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Mot de passe incorrect." });
  });

  it("setup → secret chiffré en base, inactif tant que le premier code n'est pas confirmé", async () => {
    const account = await createAccount("OWNER");
    const caller = callerFactory(authedCtx(account));

    const setup = await caller.totp.setup({ password: PASSWORD });
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.uri).toContain(`secret=${setup.secret}`);
    expect(setup.qrCode.startsWith("data:image/png;base64,")).toBe(true);

    const stored = await adminDb.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(stored.totpSecret).not.toBeNull();
    expect(stored.totpSecret).not.toContain(setup.secret);
    expect(stored.totpEnabledAt).toBeNull();
    expect((await caller.totp.status()).enabled).toBe(false);

    await expect(caller.totp.enable({ code: "000000" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });

    await caller.totp.enable({ code: totpCode(setup.secret, new Date()) });
    expect((await caller.totp.status()).enabled).toBe(true);

    const audit = await adminDb.auditLog.findFirst({
      where: { organizationId: account.orgId, action: "auth.totp_enabled" },
    });
    expect(audit).not.toBeNull();
  });

  it("désactivation : mot de passe requis, secret effacé, audité", async () => {
    const account = await createAccount("OWNER");
    await enableTotp(account);
    const caller = callerFactory(authedCtx(account));

    await expect(caller.totp.disable({ password: "faux" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await caller.totp.disable({ password: PASSWORD });

    const stored = await adminDb.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(stored.totpSecret).toBeNull();
    expect(stored.totpEnabledAt).toBeNull();
    expect(
      await adminDb.auditLog.count({
        where: { organizationId: account.orgId, action: "auth.totp_disabled" },
      }),
    ).toBe(1);
  });
});

describe("authRouter.signIn — nouvel appareil avec application d'authentification", () => {
  it("demande le code de l'appli au lieu d'envoyer un OTP, puis approuve l'appareil", async () => {
    const account = await createAccount("OWNER");
    const secret = await enableTotp(account);
    const e164 = normalizePhoneCI(account.phone).e164!;
    const sentBefore = defaultOutbox.lastFor(e164);

    const first = await callerFactory(anonymousCtx()).auth.signIn({
      identifier: account.phone,
      password: PASSWORD,
      deviceId: "totp-device-1",
    });
    expect(first).toMatchObject({ status: "OTP_REQUIRED", method: "TOTP" });
    // Aucun message WhatsApp/SMS envoyé.
    expect(defaultOutbox.lastFor(e164)).toBe(sentBefore);

    // Le code utilisé à l'activation a consommé le pas courant : on prend le suivant
    // (toléré ±30 s) pour ne pas tomber sur l'anti-rejeu.
    const nextCode = totpCode(secret, new Date(Date.now() + 30_000));
    const ok = await callerFactory(anonymousCtx()).auth.signIn({
      identifier: account.phone,
      password: PASSWORD,
      deviceId: "totp-device-1",
      otpCode: nextCode,
    });
    expect(ok.status).toBe("OK");

    const device = await adminDb.trustedDevice.findFirst({
      where: { userId: account.userId, deviceId: "totp-device-1" },
    });
    expect(device).not.toBeNull();

    // Le même code ne resservira pas sur un autre appareil (anti-rejeu).
    await expect(
      callerFactory(anonymousCtx()).auth.signIn({
        identifier: account.phone,
        password: PASSWORD,
        deviceId: "totp-device-2",
        otpCode: nextCode,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("s'applique aussi à un rôle sans OTP par défaut (MECHANIC) qui a activé l'appli", async () => {
    const account = await createAccount("MECHANIC");
    await enableTotp(account);

    const result = await callerFactory(anonymousCtx()).auth.signIn({
      identifier: account.phone,
      password: PASSWORD,
      deviceId: "totp-mechanic-device",
    });
    expect(result).toMatchObject({ status: "OTP_REQUIRED", method: "TOTP" });
  });

  it("un code faux compte comme un échec de connexion (verrouillage RG-M01-05)", async () => {
    const account = await createAccount("OWNER");
    await enableTotp(account);

    await expect(
      callerFactory(anonymousCtx()).auth.signIn({
        identifier: account.phone,
        password: PASSWORD,
        deviceId: "totp-bad-device",
        otpCode: "000000",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const stored = await adminDb.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(stored.failedLoginCount).toBe(1);
  });

  it("sans appli activée, le parcours OTP par message reste inchangé", async () => {
    const account = await createAccount("OWNER");
    const result = await callerFactory(anonymousCtx()).auth.signIn({
      identifier: account.phone,
      password: PASSWORD,
      deviceId: "otp-device",
    });
    expect(result).toMatchObject({ status: "OTP_REQUIRED", method: "WHATSAPP" });
  });

  it("téléphone perdu : la réinitialisation du mot de passe retire l'appli", async () => {
    const account = await createAccount("OWNER");
    await enableTotp(account);
    const caller = callerFactory(anonymousCtx());
    const e164 = normalizePhoneCI(account.phone).e164!;

    await caller.auth.sendOtp({ identifier: account.phone, purpose: "RESET" });
    const code = defaultOutbox.lastFor(e164)?.body.match(/code est (\d{6})/)?.[1];
    expect(code).toBeDefined();
    const { resetToken } = await caller.auth.verifyOtp({
      identifier: account.phone,
      code: code!,
      purpose: "RESET",
    });
    await caller.auth.resetPassword({ resetToken: resetToken!, newPassword: "Nouveau-Mot42" });

    const stored = await adminDb.user.findUniqueOrThrow({ where: { id: account.userId } });
    expect(stored.totpSecret).toBeNull();
    expect(stored.totpEnabledAt).toBeNull();
  });
});

describe("authRouter — inscription avec application d'authentification (sans message)", () => {
  function signUpInput(email: string) {
    return { name: "Konan Serge", email, password: PASSWORD, acceptTerms: true as const };
  }

  function uniqueEmail() {
    return `totp-signup-${randomInt(0, 10 ** 9)}@exemple.ci`;
  }

  async function trackUser(email: string) {
    const user = await adminDb.user.findUnique({ where: { email } });
    if (user) createdUserIds.push(user.id);
    return user;
  }

  it("signUpOptions : pas de code par message en production sans canal configuré", async () => {
    for (const name of [
      "PLATFORM_WHATSAPP_PHONE_ID",
      "PLATFORM_WHATSAPP_TOKEN",
      "PLATFORM_WHATSAPP_OTP_TEMPLATE",
      "PLATFORM_SMS_PROVIDER",
      "PLATFORM_EMAIL_PROVIDER",
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("APP_ENV", "production");
    try {
      const options = await callerFactory(anonymousCtx()).auth.signUpOptions();
      expect(options.messageCodeAvailable).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("start ne crée rien ; confirm avec le bon code crée le compte, approuve l'appareil et connecte", async () => {
    const email = uniqueEmail();
    const start = await callerFactory(anonymousCtx()).auth.signUpTotpStart(signUpInput(email));
    expect(start.qrCode.startsWith("data:image/png;base64,")).toBe(true);
    expect(start.pendingToken).not.toContain(start.secret);
    expect(await adminDb.user.count({ where: { email } })).toBe(0);

    await expect(
      callerFactory(anonymousCtx()).auth.signUpTotpConfirm({
        pendingToken: start.pendingToken,
        code: "000000",
        deviceId: "signup-device",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await adminDb.user.count({ where: { email } })).toBe(0);

    const ctx = anonymousCtx();
    await callerFactory(ctx).auth.signUpTotpConfirm({
      pendingToken: start.pendingToken,
      code: totpCode(start.secret, new Date()),
      deviceId: "signup-device",
    });
    expect(ctx.resHeaders.get("set-cookie")).toContain("atelieros_session=");

    const user = await trackUser(email);
    expect(user).not.toBeNull();
    expect(user!.totpEnabledAt).not.toBeNull();
    expect(user!.emailVerifiedAt).toBeNull();
    expect(
      await adminDb.trustedDevice.count({ where: { userId: user!.id, deviceId: "signup-device" } }),
    ).toBe(1);

    // Connexion suivante depuis un autre appareil : code de l'appli demandé.
    const next = await callerFactory(anonymousCtx()).auth.signIn({
      identifier: email,
      password: PASSWORD,
      deviceId: "signup-other-device",
    });
    expect(next).toMatchObject({ status: "OTP_REQUIRED", method: "TOTP" });
  });

  it("refuse un jeton d'inscription altéré", async () => {
    const start = await callerFactory(anonymousCtx()).auth.signUpTotpStart(
      signUpInput(uniqueEmail()),
    );
    const tampered = `${start.pendingToken.slice(0, -4)}AAAA`;
    await expect(
      callerFactory(anonymousCtx()).auth.signUpTotpConfirm({
        pendingToken: tampered,
        code: totpCode(start.secret, new Date()),
        deviceId: "signup-device",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cette inscription a expiré. Recommencez depuis le début.",
    });
  });

  it("refuse un email déjà utilisé", async () => {
    const email = uniqueEmail();
    const start = await callerFactory(anonymousCtx()).auth.signUpTotpStart(signUpInput(email));
    await callerFactory(anonymousCtx()).auth.signUpTotpConfirm({
      pendingToken: start.pendingToken,
      code: totpCode(start.secret, new Date()),
      deviceId: "signup-device-a",
    });
    await trackUser(email);

    await expect(
      callerFactory(anonymousCtx()).auth.signUpTotpStart(signUpInput(email)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
