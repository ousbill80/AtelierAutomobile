import { TRPCError } from "@trpc/server";
import {
  canAddMember,
  canInviteRole,
  hashPassword as hashSecret,
  isTrivialPin,
  PIN_ELIGIBLE_ROLES,
  resolvePermissions,
  wouldRemoveLastOwner,
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
import { createConsoleMessagingProvider, type MessageChannel } from "@atelieros/integrations";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";
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

export const memberRouter = router({
  list: requirePermission("member:read")
    .input(listMembersInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const status = input.status ?? "ACTIVE";
      return tenantDb.membership.findMany({
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
      const activeMemberCount = await tenantDb.membership.count({ where: { isActive: true } });
      if (!canAddMember(org.plan, activeMemberCount)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            org.plan === "STARTER"
              ? "Votre offre STARTER permet 5 utilisateurs actifs."
              : "Limite d'utilisateurs atteinte pour votre offre actuelle.",
        });
      }

      const email = input.email?.toLowerCase().trim();
      const phone = input.phone?.trim();

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

      const provider = createConsoleMessagingProvider(input.channel as MessageChannel);
      const to = input.channel === "EMAIL" ? email! : phone!;
      await provider.send({
        to,
        channel: input.channel as MessageChannel,
        body: `Vous êtes invité(e) à rejoindre ${org.name} sur AtelierOS. Lien d'invitation : /invitation/${token}`,
        templateKey: "invitation.created",
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

      return { invitationId: invitation.id };
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
      const channel = (invitation.channel ?? "EMAIL") as MessageChannel;
      const provider = createConsoleMessagingProvider(channel);
      const to = channel === "EMAIL" ? invitation.email! : invitation.phone!;
      await provider.send({
        to,
        channel,
        body: `Rappel : vous êtes invité(e) à rejoindre ${org.name} sur AtelierOS. Lien d'invitation : /invitation/${token}`,
        templateKey: "invitation.created",
      });

      return { ok: true as const };
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

      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tenantDb.membership.findUniqueOrThrow({
        where: { id: input.membershipId },
      });
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
