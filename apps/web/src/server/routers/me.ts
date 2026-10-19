import { adminDb, db } from "@atelieros/db";
import { authedProcedure, router } from "../trpc";

export const meRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const [memberships, user] = await Promise.all([
      adminDb.membership.findMany({
        where: { userId: ctx.user.id, isActive: true },
        include: { organization: true },
      }),
      adminDb.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { id: true, name: true, phone: true, email: true },
      }),
    ]);

    const organizations = memberships.map((m) => ({
      id: m.organizationId,
      name: m.organization.name,
    }));
    const activeOrganization =
      memberships.find((m) => m.organizationId === ctx.session.activeOrganizationId)
        ?.organization ?? null;

    let allowedSites: Array<{ id: string; name: string }> = [];
    if (activeOrganization) {
      const tenantDb = db.forTenant({ organizationId: activeOrganization.id });
      allowedSites = await tenantDb.site.findMany({
        where: {
          isActive: true,
          ...(ctx.allowedSiteIds === "ALL" ? {} : { id: { in: ctx.allowedSiteIds } }),
        },
        select: { id: true, name: true },
      });
    }

    return {
      user,
      organizations,
      activeOrganization,
      activeSiteId: ctx.session?.activeSiteId ?? null,
      membership: ctx.membership,
      permissions: [...ctx.permissions],
      allowedSites,
    };
  }),
});
