import { TRPCError } from "@trpc/server";
import { canUseAllSitesOption, pickActiveSite } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  revokeSessionInputSchema,
  setActiveOrganizationInputSchema,
  setActiveSiteInputSchema,
} from "@atelieros/validators";
import { authedProcedure, orgProcedure, requireSite, router } from "../trpc";

async function siteOptions(organizationId: string, siteIds: string[] | "ALL") {
  const tenantDb = db.forTenant({ organizationId });
  const sites = await tenantDb.site.findMany({
    where: { isActive: true, ...(siteIds === "ALL" ? {} : { id: { in: siteIds } }) },
    select: { id: true, name: true },
  });
  return sites;
}

export const sessionRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const sessions = await adminDb.session.findMany({
      where: { userId: ctx.user.id },
      orderBy: { lastActiveAt: "desc" },
    });
    return sessions.map((s) => ({
      id: s.id,
      device: s.deviceId,
      userAgent: s.userAgent,
      ip: s.ipAddress,
      lastActiveAt: s.lastActiveAt,
      current: s.id === ctx.session.id,
    }));
  }),

  revoke: authedProcedure.input(revokeSessionInputSchema).mutation(async ({ ctx, input }) => {
    const target = await adminDb.session.findUnique({ where: { id: input.sessionId } });
    if (!target || target.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable." });
    }
    await adminDb.session.delete({ where: { id: input.sessionId } });
    return { ok: true as const };
  }),

  setActiveOrganization: authedProcedure
    .input(setActiveOrganizationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await db
        .forTenant({ organizationId: input.organizationId })
        .membership.findFirst({ where: { userId: ctx.user.id, isActive: true } });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Vous n'êtes plus membre de cette organisation.",
        });
      }

      const allowedSiteIds =
        membership.siteIds.length === 0 ? ("ALL" as const) : membership.siteIds;
      const sites = await siteOptions(input.organizationId, allowedSiteIds);
      const activeSiteId = pickActiveSite({
        authorizedSites: sites,
        lastActiveSiteId: null,
      });

      await adminDb.session.update({
        where: { id: ctx.session.id },
        data: {
          activeOrganizationId: input.organizationId,
          activeSiteId,
          lastActiveAt: new Date(),
        },
      });
      await adminDb.user.update({
        where: { id: ctx.user.id },
        data: { lastActiveOrganizationId: input.organizationId, lastActiveSiteId: activeSiteId },
      });

      return { ok: true as const };
    }),

  setActiveSite: orgProcedure.input(setActiveSiteInputSchema).mutation(async ({ ctx, input }) => {
    if (input.siteId === null) {
      const totalSites =
        ctx.allowedSiteIds === "ALL"
          ? (await siteOptions(ctx.organizationId, "ALL")).length
          : ctx.allowedSiteIds.length;
      if (!canUseAllSitesOption(totalSites)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "« Tous les sites » nécessite un accès à au moins deux sites.",
        });
      }
    } else {
      requireSite(ctx, input.siteId);
      const site = await db
        .forTenant({ organizationId: ctx.organizationId })
        .site.findUnique({ where: { id: input.siteId } });
      if (!site || !site.isActive) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Site introuvable." });
      }
    }

    await adminDb.session.update({
      where: { id: ctx.session.id },
      data: { activeSiteId: input.siteId, lastActiveAt: new Date() },
    });
    await adminDb.user.update({
      where: { id: ctx.user.id },
      data: { lastActiveSiteId: input.siteId },
    });

    return { ok: true as const };
  }),
});
