import { TRPCError } from "@trpc/server";
import { buildTotpUri, DEFAULT_RATE_LIMITS, verifyPassword } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { qrDataUrl } from "@atelieros/pdf";
import {
  totpDisableInputSchema,
  totpEnableInputSchema,
  totpSetupInputSchema,
} from "@atelieros/validators";
import {
  checkAndConsumeTotp,
  generateTotpSecret,
  hasTotpEnabled,
  sealTotpSecret,
} from "../auth/totp-service";
import { writeAuditLog } from "../audit";
import { assertSensitiveRateLimit } from "../security/sensitiveRateLimit";
import { authedProcedure, router } from "../trpc";
import type { CtxSession } from "../context";

/** Une session PIN d'atelier (tablette partagée) ne gère pas la sécurité du compte. */
function assertNotPinSession(session: CtxSession) {
  if (session.isPinSession) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Connectez-vous avec votre mot de passe pour modifier la sécurité du compte.",
    });
  }
}

async function assertPassword(userId: string, password: string) {
  await assertSensitiveRateLimit(`totp-password:${userId}`, DEFAULT_RATE_LIMITS.loginByIp);
  const account = await adminDb.account.findUnique({
    where: { providerId_accountId: { providerId: "credential", accountId: userId } },
  });
  if (!account?.password || !(await verifyPassword(account.password, password))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Mot de passe incorrect." });
  }
}

async function auditTotp(
  ctx: {
    user: { id: string };
    session: CtxSession;
    membership: { id: string } | null;
    ip: string;
    userAgent: string;
  },
  action: "auth.totp_enabled" | "auth.totp_disabled",
) {
  const organizationId = ctx.session.activeOrganizationId;
  if (!organizationId) return;
  await writeAuditLog({
    organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership?.id ?? null,
    action,
    entity: "User",
    entityId: ctx.user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

export const totpRouter = router({
  status: authedProcedure.query(async ({ ctx }) => {
    const user = await adminDb.user.findUniqueOrThrow({
      where: { id: ctx.user.id },
      select: { totpSecret: true, totpEnabledAt: true },
    });
    return {
      enabled: user.totpSecret !== null && user.totpEnabledAt !== null,
      enabledAt: user.totpEnabledAt,
    };
  }),

  /** Étape 1 : nouveau secret (non actif) + QR code à scanner. Remplace un réglage en attente. */
  setup: authedProcedure.input(totpSetupInputSchema).mutation(async ({ ctx, input }) => {
    assertNotPinSession(ctx.session);
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (hasTotpEnabled(user)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "L'application d'authentification est déjà activée. Désactivez-la d'abord.",
      });
    }
    await assertPassword(user.id, input.password);

    const secret = generateTotpSecret();
    await adminDb.user.update({
      where: { id: user.id },
      data: { totpSecret: sealTotpSecret(secret), totpEnabledAt: null, totpLastUsedStep: null },
    });
    const uri = buildTotpUri({
      secretBase32: secret,
      accountLabel: user.email ?? user.phone ?? user.name,
    });
    // Le secret n'est renvoyé qu'ici, une seule fois, pour la saisie manuelle dans l'appli.
    return { secret, uri, qrCode: await qrDataUrl(uri) };
  }),

  /** Étape 2 : le premier code de l'appli prouve que le scan a réussi → activation. */
  enable: authedProcedure.input(totpEnableInputSchema).mutation(async ({ ctx, input }) => {
    assertNotPinSession(ctx.session);
    await assertSensitiveRateLimit(`totp-enable:${ctx.user.id}`, DEFAULT_RATE_LIMITS.loginByIp);
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (hasTotpEnabled(user)) return { ok: true as const };
    if (!user.totpSecret) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Commencez par scanner le QR code.",
      });
    }
    if (!(await checkAndConsumeTotp(user, input.code, new Date()))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.",
      });
    }
    await adminDb.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    await auditTotp(ctx, "auth.totp_enabled");
    return { ok: true as const };
  }),

  disable: authedProcedure.input(totpDisableInputSchema).mutation(async ({ ctx, input }) => {
    assertNotPinSession(ctx.session);
    await assertPassword(ctx.user.id, input.password);
    await adminDb.user.update({
      where: { id: ctx.user.id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null },
    });
    await auditTotp(ctx, "auth.totp_disabled");
    return { ok: true as const };
  }),
});
