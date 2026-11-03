import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  computeSessionAbsoluteExpiry,
  DEFAULT_RATE_LIMITS,
  PIN_ELIGIBLE_ROLES,
  PIN_MAX_FAILED_ATTEMPTS,
  verifyPassword,
} from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { writeAuditLog } from "../audit";
import { buildSessionCookie } from "../cookies";
import { assertSensitiveRateLimit } from "../security/sensitiveRateLimit";

const DEVICE_NOT_REGISTERED = "Cet appareil n'est pas enregistré comme appareil partagé d'atelier.";

export async function signInWithPin(
  input: { deviceId: string; membershipId: string; pin: string },
  meta: { ip: string; userAgent: string | null },
  options?: { registerMissingDevice?: boolean },
): Promise<{ setCookie: string }> {
  await assertSensitiveRateLimit(`login:${meta.ip}`, DEFAULT_RATE_LIMITS.loginByIp);
  const now = new Date();
  let device = await adminDb.trustedDevice.findUnique({ where: { deviceId: input.deviceId } });
  const deviceOk =
    !!device && device.isSharedWorkshopDevice && (!device.expiresAt || device.expiresAt >= now);

  if (!deviceOk && !options?.registerMissingDevice) {
    throw new TRPCError({ code: "FORBIDDEN", message: DEVICE_NOT_REGISTERED });
  }

  const membership = await adminDb.membership.findUnique({
    where: { id: input.membershipId },
  });
  if (
    !membership ||
    !membership.isActive ||
    !PIN_ELIGIBLE_ROLES.includes(membership.role) ||
    (deviceOk && membership.organizationId !== device!.organizationId)
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
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    if (failedCount >= PIN_MAX_FAILED_ATTEMPTS) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Code PIN bloqué après plusieurs échecs. Connectez-vous avec votre mot de passe.",
      });
    }
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Code PIN incorrect." });
  }

  await adminDb.membership.update({
    where: { id: membership.id },
    data: { pinFailedCount: 0 },
  });

  if (!deviceOk) {
    device = await adminDb.trustedDevice.upsert({
      where: { deviceId: input.deviceId },
      create: {
        deviceId: input.deviceId,
        label: "Tablette atelier",
        organizationId: membership.organizationId,
        siteId: membership.siteIds[0] ?? null,
        isSharedWorkshopDevice: true,
      },
      update: {
        label: "Tablette atelier",
        organizationId: membership.organizationId,
        siteId: membership.siteIds[0] ?? null,
        isSharedWorkshopDevice: true,
        expiresAt: null,
      },
    });
  }

  const session = await adminDb.session.create({
    data: {
      userId: membership.userId,
      token: randomBytes(32).toString("hex"),
      expiresAt: computeSessionAbsoluteExpiry(now, true),
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      deviceId: input.deviceId,
      activeOrganizationId: membership.organizationId,
      activeSiteId: device?.siteId ?? membership.siteIds[0] ?? null,
      isPinSession: true,
      lastActiveAt: now,
    },
  });

  await writeAuditLog({
    organizationId: membership.organizationId,
    userId: membership.userId,
    membershipId: membership.id,
    action: "auth.login.success",
    entity: "Membership",
    entityId: membership.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { setCookie: buildSessionCookie(session.token, session.expiresAt) };
}
