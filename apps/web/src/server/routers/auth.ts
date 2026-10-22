import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  computeSessionAbsoluteExpiry,
  computeTrustedDeviceExpiry,
  DEFAULT_RATE_LIMITS,
  hashPassword,
  INITIAL_LOCKOUT_STATE,
  isLocked,
  pickActiveSite,
  PIN_ELIGIBLE_ROLES,
  PIN_MAX_FAILED_ATTEMPTS,
  recordFailedLogin,
  requiresNewDeviceOtp,
  type SecuritySettingsLike,
  verifyPassword,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  pinSignInInputSchema,
  resetPasswordInputSchema,
  sendOtpInputSchema,
  signInInputSchema,
  signUpInputSchema,
  verifyOtpInputSchema,
} from "@atelieros/validators";
import { resolveIdentifier } from "../auth/identifier";
import {
  hashResetToken,
  sendOtp as sendOtpCode,
  verifyOtp as verifyOtpCode,
} from "../auth/otp-service";
import { assertPasswordPolicy } from "../auth/password-policy";
import { buildSessionCookie, clearSessionCookie } from "../cookies";
import { authedProcedure, publicProcedure, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { assertSensitiveRateLimit } from "../security/sensitiveRateLimit";

const RESET_TOKEN_EXPIRY_MINUTES = 10;

async function findUserByIdentifier(identifier: ReturnType<typeof resolveIdentifier>) {
  return identifier.kind === "EMAIL"
    ? adminDb.user.findUnique({ where: { email: identifier.value } })
    : adminDb.user.findUnique({ where: { phone: identifier.value } });
}

/** Écrit l'entrée d'audit dans chaque organisation où le compte a une adhésion active (RG-M01-05/15). */
async function writeAuditLogToAllMemberships(
  userId: string,
  action: string,
  ip: string | null,
  userAgent: string | null,
) {
  const memberships = await adminDb.membership.findMany({ where: { userId, isActive: true } });
  await Promise.all(
    memberships.map((membership) =>
      writeAuditLog({
        organizationId: membership.organizationId,
        userId,
        membershipId: membership.id,
        action,
        entity: "Membership",
        entityId: membership.id,
        ip,
        userAgent,
      }),
    ),
  );
}

async function resolveActiveMembership(user: {
  id: string;
  lastActiveOrganizationId: string | null;
}) {
  if (!user.lastActiveOrganizationId) return null;
  const membership = await db
    .forTenant({ organizationId: user.lastActiveOrganizationId })
    .membership.findFirst({ where: { userId: user.id, isActive: true } });
  if (!membership) return null;
  return { organizationId: user.lastActiveOrganizationId, membership };
}

/** RG-M01-10 — dernier site utilisé s'il est toujours autorisé, sinon le premier par ordre alphabétique. */
async function resolveActiveSiteId(
  organizationId: string,
  siteIds: string[],
  lastActiveSiteId: string | null,
): Promise<string | null> {
  const allowedSiteIds = siteIds.length === 0 ? ("ALL" as const) : siteIds;
  const sites = await db.forTenant({ organizationId }).site.findMany({
    where: { isActive: true, ...(allowedSiteIds === "ALL" ? {} : { id: { in: allowedSiteIds } }) },
    select: { id: true, name: true },
  });
  if (sites.length === 0) return null;
  return pickActiveSite({ authorizedSites: sites, lastActiveSiteId });
}

async function createSessionForUser(
  userId: string,
  deviceId: string,
  ip: string,
  userAgent: string,
  now: Date,
  activeMembership: Awaited<ReturnType<typeof resolveActiveMembership>>,
) {
  const token = randomBytes(32).toString("hex");
  const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
  const activeOrganizationId = activeMembership?.organizationId ?? null;
  const activeSiteId = activeMembership
    ? await resolveActiveSiteId(
        activeMembership.organizationId,
        activeMembership.membership.siteIds,
        user.lastActiveSiteId,
      )
    : null;

  const session = await adminDb.session.create({
    data: {
      userId,
      token,
      expiresAt: computeSessionAbsoluteExpiry(now, false),
      ipAddress: ip,
      userAgent,
      deviceId,
      activeOrganizationId,
      activeSiteId,
      isPinSession: false,
      lastActiveAt: now,
    },
  });
  return session;
}

export const authRouter = router({
  signUp: publicProcedure.input(signUpInputSchema).mutation(async ({ input }) => {
    const email = input.email?.toLowerCase().trim();
    const phone = input.phone ? resolveIdentifier(input.phone).value : undefined;

    assertPasswordPolicy(input.password, { phone: input.phone });

    const existing = await adminDb.user.findFirst({
      where: {
        OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as never,
      },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Un compte existe déjà avec cet identifiant.",
      });
    }

    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    const user = await adminDb.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { name: input.name, email, phone, locale: "fr" },
      });
      await tx.account.create({
        data: {
          userId: createdUser.id,
          providerId: "credential",
          accountId: createdUser.id,
          password: passwordHash,
        },
      });
      return createdUser;
    });

    const otpChannel = phone ? "WHATSAPP" : "EMAIL";
    const identifier = phone ?? email!;
    const { devCode } = await sendOtpCode(identifier, "VERIFY", otpChannel, now);

    return { userId: user.id, otpChannel, devCode };
  }),

  sendOtp: publicProcedure.input(sendOtpInputSchema).mutation(async ({ input, ctx }) => {
    const resolved = resolveIdentifier(input.identifier);
    assertSensitiveRateLimit(`otp:${resolved.value}`, DEFAULT_RATE_LIMITS.otpByIdentifier);
    assertSensitiveRateLimit(`otp-ip:${ctx.ip}`, DEFAULT_RATE_LIMITS.otpByIdentifier);
    const channel = input.channel ?? (resolved.kind === "PHONE" ? "WHATSAPP" : "EMAIL");
    try {
      return await sendOtpCode(resolved.value, input.purpose, channel, new Date());
    } catch {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Veuillez patienter avant de redemander un code.",
      });
    }
  }),

  verifyOtp: publicProcedure.input(verifyOtpInputSchema).mutation(async ({ input }) => {
    const resolved = resolveIdentifier(input.identifier);
    const now = new Date();
    const outcome = await verifyOtpCode(resolved.value, input.code, input.purpose, now);

    if (outcome === "EXPIRED") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Code expiré. Demandez-en un nouveau." });
    }
    if (outcome === "TOO_MANY_ATTEMPTS") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Trop de tentatives. Demandez un nouveau code.",
      });
    }
    if (outcome === "INVALID_CODE" || outcome === "NOT_FOUND") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Code incorrect." });
    }

    if (input.purpose === "VERIFY") {
      const user = await findUserByIdentifier(resolved);
      if (user) {
        await adminDb.user.update({
          where: { id: user.id },
          data: resolved.kind === "EMAIL" ? { emailVerifiedAt: now } : { phoneVerifiedAt: now },
        });
      }
      return { ok: true as const };
    }

    if (input.purpose === "RESET") {
      const user = await findUserByIdentifier(resolved);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Aucun compte pour cet identifiant." });
      }
      const randomPart = randomBytes(24).toString("hex");
      const resetToken = `${user.id}.${randomPart}`;
      await adminDb.verification.create({
        data: {
          identifier: `RESET_TOKEN:${user.id}`,
          value: hashResetToken(resetToken),
          attempts: 0,
          expiresAt: new Date(now.getTime() + RESET_TOKEN_EXPIRY_MINUTES * 60_000),
        },
      });
      return { ok: true as const, resetToken };
    }

    return { ok: true as const };
  }),

  signIn: publicProcedure.input(signInInputSchema).mutation(async ({ input, ctx }) => {
    assertSensitiveRateLimit(`login:${ctx.ip}`, DEFAULT_RATE_LIMITS.loginByIp);
    const resolved = resolveIdentifier(input.identifier);
    const user = await findUserByIdentifier(resolved);
    const now = new Date();

    if (!user || !user.isActive) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Identifiants invalides." });
    }

    if (isLocked({ lockedUntil: user.lockedUntil }, now)) {
      return { status: "LOCKED" as const, lockedUntil: user.lockedUntil };
    }

    const activeMembership = await resolveActiveMembership(user);

    const account = await adminDb.account.findUnique({
      where: { providerId_accountId: { providerId: "credential", accountId: user.id } },
    });
    if (!account?.password || !(await verifyPassword(account.password, input.password))) {
      const nextState = recordFailedLogin(
        {
          failedLoginCount: user.failedLoginCount,
          lockCount: user.lockCount,
          lockedUntil: user.lockedUntil,
        },
        now,
      );
      await adminDb.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: nextState.failedLoginCount,
          lockCount: nextState.lockCount,
          lockedUntil: nextState.lockedUntil,
        },
      });
      if (nextState.lockedUntil) {
        await writeAuditLogToAllMemberships(user.id, "auth.locked", ctx.ip, ctx.userAgent);
        return { status: "LOCKED" as const, lockedUntil: nextState.lockedUntil };
      }
      if (activeMembership) {
        await writeAuditLog({
          organizationId: activeMembership.organizationId,
          userId: user.id,
          membershipId: activeMembership.membership.id,
          action: "auth.login.failed",
          entity: "Membership",
          entityId: activeMembership.membership.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Identifiants invalides." });
    }

    if (activeMembership) {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: activeMembership.organizationId },
      });
      const security = (org.settings as { security?: SecuritySettingsLike } | null)?.security;

      if (requiresNewDeviceOtp(security, activeMembership.membership.role)) {
        const trustedDevice = await adminDb.trustedDevice.findFirst({
          where: {
            deviceId: input.deviceId,
            userId: user.id,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        });

        if (!trustedDevice) {
          const otpChannel = resolved.kind === "PHONE" ? "WHATSAPP" : "EMAIL";

          if (!input.otpCode) {
            let devCode: string | undefined;
            try {
              devCode = (await sendOtpCode(resolved.value, "NEW_DEVICE", otpChannel, now)).devCode;
            } catch {
              // Un code a déjà été envoyé récemment : le client peut saisir le dernier reçu.
            }
            return { status: "OTP_REQUIRED" as const, devCode };
          }

          const outcome = await verifyOtpCode(resolved.value, input.otpCode, "NEW_DEVICE", now);
          if (outcome !== "OK") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Code incorrect ou expiré." });
          }

          const device = await adminDb.trustedDevice.upsert({
            where: { deviceId: input.deviceId },
            create: {
              deviceId: input.deviceId,
              userId: user.id,
              organizationId: activeMembership.organizationId,
              expiresAt: computeTrustedDeviceExpiry(now),
            },
            update: {
              userId: user.id,
              organizationId: activeMembership.organizationId,
              expiresAt: computeTrustedDeviceExpiry(now),
            },
          });

          await writeAuditLog({
            organizationId: activeMembership.organizationId,
            userId: user.id,
            membershipId: activeMembership.membership.id,
            action: "auth.otp_new_device",
            entity: "TrustedDevice",
            entityId: device.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
    }

    await adminDb.user.update({
      where: { id: user.id },
      data: { ...INITIAL_LOCKOUT_STATE, lastLoginAt: now },
    });

    const session = await createSessionForUser(
      user.id,
      input.deviceId,
      ctx.ip,
      ctx.userAgent,
      now,
      activeMembership,
    );
    ctx.resHeaders.append("set-cookie", buildSessionCookie(session.token, session.expiresAt));

    if (activeMembership) {
      await writeAuditLog({
        organizationId: activeMembership.organizationId,
        userId: user.id,
        membershipId: activeMembership.membership.id,
        action: "auth.login.success",
        entity: "Membership",
        entityId: activeMembership.membership.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    return { status: "OK" as const };
  }),

  pinSignIn: publicProcedure.input(pinSignInInputSchema).mutation(async ({ input, ctx }) => {
    assertSensitiveRateLimit(`login:${ctx.ip}`, DEFAULT_RATE_LIMITS.loginByIp);
    const now = new Date();
    const device = await adminDb.trustedDevice.findUnique({ where: { deviceId: input.deviceId } });
    if (!device || !device.isSharedWorkshopDevice || (device.expiresAt && device.expiresAt < now)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cet appareil n'est pas enregistré comme appareil partagé d'atelier.",
      });
    }

    const membership = await adminDb.membership.findUnique({
      where: { id: input.membershipId },
    });
    if (
      !membership ||
      !membership.isActive ||
      membership.organizationId !== device.organizationId ||
      !PIN_ELIGIBLE_ROLES.includes(membership.role)
    ) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Connexion par code PIN non autorisée pour ce membre.",
      });
    }

    if (!membership.pinHash) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Aucun code PIN n'est défini pour ce membre.",
      });
    }

    if (membership.pinFailedCount >= PIN_MAX_FAILED_ATTEMPTS) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Code PIN bloqué après plusieurs échecs. Connectez-vous avec votre mot de passe.",
      });
    }

    const pinIsValid = await verifyPassword(membership.pinHash, input.pin);
    if (!pinIsValid) {
      const failedCount = membership.pinFailedCount + 1;
      await adminDb.membership.update({
        where: { id: membership.id },
        data: { pinFailedCount: failedCount },
      });
      await writeAuditLog({
        organizationId: membership.organizationId,
        userId: membership.userId,
        membershipId: membership.id,
        action: "auth.login.failed",
        entity: "Membership",
        entityId: membership.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      if (failedCount >= PIN_MAX_FAILED_ATTEMPTS) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Code PIN bloqué après plusieurs échecs. Connectez-vous avec votre mot de passe.",
        });
      }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Code PIN incorrect." });
    }

    await adminDb.membership.update({
      where: { id: membership.id },
      data: { pinFailedCount: 0 },
    });

    const session = await adminDb.session.create({
      data: {
        userId: membership.userId,
        token: randomBytes(32).toString("hex"),
        expiresAt: computeSessionAbsoluteExpiry(now, true),
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        deviceId: input.deviceId,
        activeOrganizationId: membership.organizationId,
        activeSiteId: device.siteId ?? membership.siteIds[0] ?? null,
        isPinSession: true,
        lastActiveAt: now,
      },
    });
    ctx.resHeaders.append("set-cookie", buildSessionCookie(session.token, session.expiresAt));

    await writeAuditLog({
      organizationId: membership.organizationId,
      userId: membership.userId,
      membershipId: membership.id,
      action: "auth.login.success",
      entity: "Membership",
      entityId: membership.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { ok: true as const };
  }),

  resetPassword: publicProcedure
    .input(resetPasswordInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [userId] = input.resetToken.split(".");
      if (!userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Jeton de réinitialisation invalide.",
        });
      }

      const now = new Date();
      const row = await adminDb.verification.findFirst({
        where: { identifier: `RESET_TOKEN:${userId}` },
        orderBy: { createdAt: "desc" },
      });
      if (
        !row ||
        row.expiresAt.getTime() < now.getTime() ||
        row.value !== hashResetToken(input.resetToken)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Jeton de réinitialisation invalide ou expiré.",
        });
      }

      const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });
      assertPasswordPolicy(input.newPassword, { phone: user.phone });

      const passwordHash = await hashPassword(input.newPassword);
      await adminDb.$transaction([
        adminDb.account.update({
          where: { providerId_accountId: { providerId: "credential", accountId: userId } },
          data: { password: passwordHash },
        }),
        adminDb.session.deleteMany({ where: { userId } }),
        adminDb.verification.delete({ where: { id: row.id } }),
        adminDb.user.update({ where: { id: userId }, data: { ...INITIAL_LOCKOUT_STATE } }),
      ]);

      await writeAuditLogToAllMemberships(userId, "auth.password_reset", ctx.ip, ctx.userAgent);

      return { ok: true as const };
    }),

  signOut: authedProcedure.mutation(async ({ ctx }) => {
    await adminDb.session.delete({ where: { id: ctx.session.id } }).catch(() => undefined);
    ctx.resHeaders.append("set-cookie", clearSessionCookie());
    return { ok: true as const };
  }),
});
