import { TRPCError } from "@trpc/server";
import {
  canInviteRole,
  hashPassword as hashSecret,
  isDomainError,
  isTrivialPin,
  normalizePhoneCI,
  PIN_ELIGIBLE_ROLES,
  resolvePermissions,
  wouldRemoveLastOwner,
  type Channel,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  deactivateMemberInputSchema,
  getMemberInputSchema,
  inviteMemberInputSchema,
  listMembersInputSchema,
  reactivateMemberInputSchema,
  resendInvitationInputSchema,
  revokeAllSessionsInputSchema,
  revokeInvitationInputSchema,
  setPinInputSchema,
  updateMemberInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { deliverInvitation } from "../invitations/deliver";
import { writeAuditLog } from "../audit";
import { assertPlanLimit } from "../plan/limits";
import {
  computeInvitationExpiry,
  generateInvitationToken,
  hashInvitationToken,
} from "../invitation-token";

async function assertCanManageLastOwner(organizationId: string, membershipId: string) {
  const memberships = await db
    .forTenant({ organizationId })
    .membership.findMany({ select: { id: true, role: true, isActive: true } });
  if (wouldRemoveLastOwner(memberships, membershipId)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "L'organisation doit garder au moins un gérant.",
    });
  }
}

/** RG-M01-12 : on ne gère (rôle, sites, désactivation) que les rôles qu'on pourrait inviter. */
function assertCanManageMember(
  actor: { id: string; role: Parameters<typeof canInviteRole>[0] },
  target: { id: string; role: Parameters<typeof canInviteRole>[1] },
) {
  if (actor.id !== target.id && !canInviteRole(actor.role, target.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous ne pouvez pas modifier un membre de ce rôle.",
    });
  }
}

/** Normalise le téléphone d'invitation en E.164 (core/phone), avec une erreur lisible. */
function normalizeInvitePhone(input: string | undefined): string | undefined {
  const raw = input?.trim();
  if (!raw) return undefined;
  const invalid = new TRPCError({
    code: "BAD_REQUEST",
    message:
      "Numéro de téléphone invalide. Saisissez un numéro ivoirien à 10 chiffres (ex. 07 08 09 10 11).",
  });
  let e164: string | null;
  try {
    e164 = normalizePhoneCI(raw).e164;
  } catch (error) {
    if (isDomainError(error)) throw invalid;
    throw error;
  }
  if (!e164) throw invalid;
  return e164;
}

export const memberRouter = router({
  list: requirePermission("member:read")
    .input(listMembersInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const status = input.status ?? "ACTIVE";
      const rows = await tenantDb.membership.findMany({
        where: {
          ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
          ...(input.role ? { role: input.role } : {}),
          ...(input.siteId
            ? { OR: [{ siteIds: { has: input.siteId } }, { siteIds: { isEmpty: true } }] }
            : {}),
        },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      });
      return rows.map(({ pinHash, ...rest }) => ({ ...rest, hasPin: Boolean(pinHash) }));
    }),

  get: requirePermission("member:read")
    .input(getMemberInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const membership = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
        include: { user: true },
      });
      const rolePermissionRow = await tenantDb.rolePermission.findFirst({
        where: { role: membership.role },
      });
      const effectivePermissions = [
        ...resolvePermissions({
          role: membership.role,
          organizationRolePermissions: rolePermissionRow?.permissions,
          membershipOverrides: membership.permissions,
        }),
      ];
      return { ...membership, effectivePermissions };
    }),

  listInvitations: requirePermission("member:invite").query(async ({ ctx }) => {
    return adminDb.invitation.findMany({
      where: { organizationId: ctx.organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  }),

  invite: requirePermission("member:invite")
    .input(inviteMemberInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!canInviteRole(ctx.membership.role, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Vous ne pouvez pas inviter ce rôle.",
        });
      }

      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      await assertPlanLimit(ctx.organizationId, "activeMembers");

      const email = input.email?.toLowerCase().trim();
      const phone = normalizeInvitePhone(input.phone);
      if (input.channel !== "EMAIL" && !phone) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Indiquez le téléphone : l'invitation est envoyée sur ce numéro.",
        });
      }
      if (input.channel === "EMAIL" && !email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Indiquez l'email : l'invitation est envoyée par email.",
        });
      }

      const existingUser = await adminDb.user.findFirst({
        where: {
          OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(
            Boolean,
          ) as never,
        },
      });
      if (existingUser) {
        const existingMembership = await tenantDb.membership.findFirst({
          where: { userId: existingUser.id, isActive: true },
        });
        if (existingMembership) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Cette personne est déjà membre de l'organisation.",
          });
        }
      }

      const pendingInvitation = await adminDb.invitation.findFirst({
        where: {
          organizationId: ctx.organizationId,
          status: "PENDING",
          OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(
            Boolean,
          ) as never,
        },
      });
      if (pendingInvitation) {
        await adminDb.invitation.update({
          where: { id: pendingInvitation.id },
          data: { status: "REVOKED" },
        });
      }

      const now = new Date();
      const token = generateInvitationToken();
      const invitation = await adminDb.invitation.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          email,
          phone,
          role: input.role,
          siteIds: input.siteIds,
          permissions: [],
          tokenHash: hashInvitationToken(token),
          channel: input.channel,
          status: "PENDING",
          invitedById: ctx.membership.id,
          expiresAt: computeInvitationExpiry(now),
        },
      });

      const to = input.channel === "EMAIL" ? email! : phone!;
      const delivered = await deliverInvitation({
        organizationId: ctx.organizationId,
        invitationId: invitation.id,
        channel: input.channel as Channel,
        to,
        recipientName: input.name,
        organizationName: org.name,
        role: input.role,
        token,
        kind: "created",
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "member.invited",
        entity: "Invitation",
        entityId: invitation.id,
        after: { name: invitation.name, role: invitation.role, siteIds: invitation.siteIds },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { invitationId: invitation.id, ...delivered };
    }),

  resendInvitation: requirePermission("member:invite")
    .input(resendInvitationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const invitation = await adminDb.invitation.findFirst({
        where: { id: input.invitationId, organizationId: ctx.organizationId },
      });
      if (!invitation || invitation.status !== "PENDING") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invitation introuvable." });
      }

      const now = new Date();
      const token = generateInvitationToken();
      await adminDb.invitation.update({
        where: { id: invitation.id },
        data: { tokenHash: hashInvitationToken(token), expiresAt: computeInvitationExpiry(now) },
      });

      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const channel = (invitation.channel ?? "EMAIL") as Channel;
      const to = channel === "EMAIL" ? invitation.email! : invitation.phone!;
      const delivered = await deliverInvitation({
        organizationId: ctx.organizationId,
        invitationId: invitation.id,
        channel,
        to,
        recipientName: invitation.name,
        organizationName: org.name,
        role: invitation.role,
        token,
        kind: "resent",
      });

      return { ok: true as const, ...delivered };
    }),

  revokeInvitation: requirePermission("member:invite")
    .input(revokeInvitationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const invitation = await adminDb.invitation.findFirst({
        where: { id: input.invitationId, organizationId: ctx.organizationId },
      });
      if (!invitation || invitation.status !== "PENDING") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invitation introuvable." });
      }
      await adminDb.invitation.update({
        where: { id: invitation.id },
        data: { status: "REVOKED" },
      });
      return { ok: true as const };
    }),

  update: requirePermission("member:update")
    .input(updateMemberInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });
      assertCanManageMember(ctx.membership, before);

      if (input.role && input.role !== before.role) {
        if (!canInviteRole(ctx.membership.role, input.role)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Vous ne pouvez pas attribuer ce rôle.",
          });
        }
        if (before.role === "OWNER") {
          await assertCanManageLastOwner(ctx.organizationId, input.membershipId);
        }
      }

      const after = await tenantDb.membership.update({
        where: { id: input.membershipId },
        data: {
          role: input.role,
          siteIds: input.siteIds,
          permissions: input.permissions,
          hourlyCost: input.hourlyCost,
          skills: input.skills,
        },
      });

      if (input.role && input.role !== before.role) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "member.role_changed",
          entity: "Membership",
          entityId: after.id,
          before: { role: before.role },
          after: { role: after.role },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      if (
        input.permissions &&
        JSON.stringify(input.permissions) !== JSON.stringify(before.permissions)
      ) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "member.permissions_changed",
          entity: "Membership",
          entityId: after.id,
          before: { permissions: before.permissions },
          after: { permissions: after.permissions },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      if (input.siteIds && JSON.stringify(input.siteIds) !== JSON.stringify(before.siteIds)) {
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "member.sites_changed",
          entity: "Membership",
          entityId: after.id,
          before: { siteIds: before.siteIds },
          after: { siteIds: after.siteIds },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      return after;
    }),

  deactivate: requirePermission("member:deactivate")
    .input(deactivateMemberInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCanManageLastOwner(ctx.organizationId, input.membershipId);
      if (input.membershipId === ctx.membership.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Vous ne pouvez pas désactiver votre propre accès. Demandez à un autre gérant de le faire.",
        });
      }

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });
      assertCanManageMember(ctx.membership, before);
      if (!before.isActive) {
        throw new TRPCError({ code: "CONFLICT", message: "Ce membre est déjà désactivé." });
      }
      const after = await tenantDb.membership.update({
        where: { id: input.membershipId },
        data: { isActive: false, deactivatedAt: new Date(), deactivationReason: input.reason },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "member.deactivated",
        entity: "Membership",
        entityId: after.id,
        before: { isActive: before.isActive },
        after: { isActive: after.isActive },
        reason: input.reason,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  reactivate: requirePermission("member:deactivate")
    .input(reactivateMemberInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });
      assertCanManageMember(ctx.membership, before);
      if (before.isActive) {
        throw new TRPCError({ code: "CONFLICT", message: "Ce membre est déjà actif." });
      }
      await assertPlanLimit(ctx.organizationId, "activeMembers");

      const after = await tenantDb.membership.update({
        where: { id: input.membershipId },
        data: { isActive: true, deactivatedAt: null, deactivationReason: null },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "member.reactivated",
        entity: "Membership",
        entityId: after.id,
        after: { isActive: after.isActive },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),

  setPin: requirePermission("member:update")
    .input(setPinInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const membership = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });

      if (!PIN_ELIGIBLE_ROLES.includes(membership.role)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Le code PIN n'est disponible que pour les rôles Manager, Mécanicien et Magasinier.",
        });
      }
      if (isTrivialPin(input.pin)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Ce code PIN est trop simple. Choisissez une suite moins prévisible.",
        });
      }

      const pinHash = await hashSecret(input.pin);
      await tenantDb.membership.update({
        where: { id: input.membershipId },
        data: { pinHash, pinFailedCount: 0 },
      });

      return { ok: true as const };
    }),

  revokeAllSessions: requirePermission("member:update")
    .input(revokeAllSessionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const membership = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });
      assertCanManageMember(ctx.membership, membership);

      const result = await adminDb.session.deleteMany({
        where: { userId: membership.userId, activeOrganizationId: ctx.organizationId },
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "session.revoked",
        entity: "Membership",
        entityId: membership.id,
        after: { revokedCount: result.count },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return { revokedCount: result.count };
    }),
});
