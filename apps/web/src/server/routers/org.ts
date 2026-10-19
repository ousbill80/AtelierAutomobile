import { adminDb } from "@atelieros/db";
import { updateOrgInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";
import { writeAuditLog } from "../audit";

// Organization est la racine du tenant (pas de champ organizationId sur elle-même) :
// db.forTenant ne s'applique pas à ce modèle, adminDb filtré explicitement par id est requis.
export const orgRouter = router({
  get: requirePermission("org:read").query(async ({ ctx }) => {
    return adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  }),

  update: requirePermission("org:update")
    .input(updateOrgInputSchema)
    .mutation(async ({ ctx, input }) => {
      const before = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });

      const after = await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: input,
      });

      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "org.updated",
        entity: "Organization",
        entityId: ctx.organizationId,
        before,
        after,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return after;
    }),
});
