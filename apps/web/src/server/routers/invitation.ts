import { TRPCError } from "@trpc/server";
import { hashPassword } from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import { acceptInvitationInputSchema, invitationPreviewInputSchema } from "@atelieros/validators";
import { publicProcedure, router } from "../trpc";
import { writeAuditLog } from "../audit";
import { hashInvitationToken } from "../invitation-token";
import { assertPasswordPolicy } from "../auth/password-policy";

const INVITATION_INVALID_MESSAGE =
  "Cette invitation n'est plus valable. Demandez une nouvelle invitation à votre gérant.";

async function findValidInvitation(token: string) {
  const invitation = await adminDb.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
  });
  if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
    return null;
  }
  return invitation;
}

export const invitationRouter = router({
  preview: publicProcedure.input(invitationPreviewInputSchema).query(async ({ input }) => {
    const invitation = await findValidInvitation(input.token);
    if (!invitation) {
      throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_INVALID_MESSAGE });
    }

    const organization = await adminDb.organization.findUniqueOrThrow({
      where: { id: invitation.organizationId },
    });
    const inviter = await adminDb.membership.findUnique({
      where: { id: invitation.invitedById },
      include: { user: true },
    });

    return {
      organizationName: organization.name,
      role: invitation.role,
      inviterName: inviter?.user.name ?? null,
      expiresAt: invitation.expiresAt,
    };
  }),

  accept: publicProcedure.input(acceptInvitationInputSchema).mutation(async ({ input }) => {
    const invitation = await findValidInvitation(input.token);
    if (!invitation) {
      throw new TRPCError({ code: "NOT_FOUND", message: INVITATION_INVALID_MESSAGE });
    }

    const existingUser = await adminDb.user.findFirst({
      where: {
        OR: [
          invitation.email ? { email: invitation.email } : undefined,
          invitation.phone ? { phone: invitation.phone } : undefined,
        ].filter(Boolean) as never,
      },
    });

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      if (!input.password) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Un mot de passe est requis pour créer votre compte.",
        });
      }
      const organization = await adminDb.organization.findUniqueOrThrow({
        where: { id: invitation.organizationId },
      });
      assertPasswordPolicy(input.password, {
        garageName: organization.name,
        phone: invitation.phone,
      });
      const passwordHash = await hashPassword(input.password);
      const now = new Date();
      const createdUser = await adminDb.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: invitation.name,
            email: invitation.email,
            phone: invitation.phone,
            emailVerifiedAt: invitation.email ? now : null,
            phoneVerifiedAt: invitation.phone ? now : null,
          },
        });
        await tx.account.create({
          data: {
            userId: user.id,
            providerId: "credential",
            accountId: user.id,
            password: passwordHash,
          },
        });
        return user;
      });
      userId = createdUser.id;
    }

    const membership = await adminDb.membership.create({
      data: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        siteIds: invitation.siteIds,
        permissions: invitation.permissions,
        invitedById: invitation.invitedById,
        isActive: true,
      },
    });

    await adminDb.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedUserId: userId },
    });

    await writeAuditLog({
      organizationId: invitation.organizationId,
      userId,
      membershipId: membership.id,
      action: "member.joined",
      entity: "Membership",
      entityId: membership.id,
      after: { role: membership.role, siteIds: membership.siteIds },
    });

    return { ok: true as const };
  }),
});
