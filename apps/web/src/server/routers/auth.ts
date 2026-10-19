import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  computeSessionAbsoluteExpiry,
  hashPassword,
  INITIAL_LOCKOUT_STATE,
  isLocked,
  recordFailedLogin,
  verifyPassword,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
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
import { buildSessionCookie, clearSessionCookie } from "../cookies";
import { authedProcedure, publicProcedure, router } from "../trpc";

const RESET_TOKEN_EXPIRY_MINUTES = 10;

async function findUserByIdentifier(identifier: ReturnType<typeof resolveIdentifier>) {
  return identifier.kind === "EMAIL"
    ? adminDb.user.findUnique({ where: { email: identifier.value } })
    : adminDb.user.findUnique({ where: { phone: identifier.value } });
}

async function createSessionForUser(
  userId: string,
  deviceId: string,
  ip: string,
  userAgent: string,
  now: Date,
) {
  const token = randomBytes(32).toString("hex");
  const user = await adminDb.user.findUniqueOrThrow({ where: { id: userId } });

  let activeOrganizationId: string | null = null;
  if (user.lastActiveOrganizationId) {
    const membership = await db
      .forTenant({ organizationId: user.lastActiveOrganizationId })
      .membership.findFirst({ where: { userId, isActive: true } });
    if (membership) {
      activeOrganizationId = user.lastActiveOrganizationId;
    }
  }

  const session = await adminDb.session.create({
    data: {
      userId,
      token,
      expiresAt: computeSessionAbsoluteExpiry(now, false),
      ipAddress: ip,
      userAgent,
      deviceId,
      activeOrganizationId,
      activeSiteId: activeOrganizationId ? user.lastActiveSiteId : null,
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
    await sendOtpCode(identifier, "VERIFY", otpChannel, now);

    return { userId: user.id, otpChannel };
  }),

  sendOtp: publicProcedure.input(sendOtpInputSchema).mutation(async ({ input }) => {
    const resolved = resolveIdentifier(input.identifier);
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
    const resolved = resolveIdentifier(input.identifier);
    const user = await findUserByIdentifier(resolved);
    const now = new Date();

    if (!user || !user.isActive) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Identifiants invalides." });
    }

    if (isLocked({ lockedUntil: user.lockedUntil }, now)) {
      return { status: "LOCKED" as const, lockedUntil: user.lockedUntil };
    }

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
        return { status: "LOCKED" as const, lockedUntil: nextState.lockedUntil };
      }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Identifiants invalides." });
    }

    await adminDb.user.update({
      where: { id: user.id },
      data: { ...INITIAL_LOCKOUT_STATE, lastLoginAt: now },
    });

    const session = await createSessionForUser(user.id, input.deviceId, ctx.ip, ctx.userAgent, now);
    ctx.resHeaders.append("set-cookie", buildSessionCookie(session.token, session.expiresAt));

    return { status: "OK" as const };
  }),

  resetPassword: publicProcedure.input(resetPasswordInputSchema).mutation(async ({ input }) => {
    const [userId] = input.resetToken.split(".");
    if (!userId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Jeton de réinitialisation invalide." });
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

    return { ok: true as const };
  }),

  signOut: authedProcedure.mutation(async ({ ctx }) => {
    await adminDb.session.delete({ where: { id: ctx.session.id } }).catch(() => undefined);
    ctx.resHeaders.append("set-cookie", clearSessionCookie());
    return { ok: true as const };
  }),
});
