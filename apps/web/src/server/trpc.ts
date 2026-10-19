import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { isDomainError, type Permission } from "@atelieros/core";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "./context";

const t = initTRPC.context<Ctx>().create({
  transformer: superjson,
  // Une `DomainError` (packages/core) placée en `cause` expose son code et ses détails
  // structurés au client (ex. SLOT_CONFLICT { conflictingId }, CAPACITY_EXCEEDED { load, capacity })
  // pour que l'interface réagisse autrement qu'avec le seul message (M03 §8).
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    if (isDomainError(cause)) {
      return {
        ...shape,
        data: { ...shape.data, domain: { code: cause.code, details: cause.details ?? null } },
      };
    }
    return shape;
  },
});

export const router = t.router;
export const middleware = t.middleware;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session invalide ou expirée." });
  }
  return next({
    ctx: { ...ctx, user: ctx.user as CtxUser, session: ctx.session as CtxSession },
  });
});

export const orgProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.activeOrganizationId || !ctx.membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Aucune organisation active pour cette session.",
    });
  }
  assertOrgHeaderMatches(ctx, ctx.orgHeaderId ?? null);
  return next({
    ctx: {
      ...ctx,
      membership: ctx.membership as CtxMembership,
      organizationId: ctx.session.activeOrganizationId,
    },
  });
});

/** Vérifie le header x-org-id contre l'organisation active de la session (US-M01, RG bascule). */
export function assertOrgHeaderMatches(ctx: { session: CtxSession }, headerOrgId: string | null) {
  if (headerOrgId && headerOrgId !== ctx.session.activeOrganizationId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Le garage actif a changé. Rechargez la page.",
    });
  }
}

export function requirePermission(...perms: Permission[]) {
  return orgProcedure.use(({ ctx, next }) => {
    const missing = perms.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permission manquante : ${missing.join(", ")}`,
      });
    }
    return next({ ctx });
  });
}

/** RG-M01-09 : portée par site. À appeler explicitement dans les résolveurs avec le siteId de l'entité visée. */
export function requireSite(
  ctx: { allowedSiteIds: string[] | "ALL" },
  siteId: string | null | undefined,
): void {
  if (!siteId) return;
  if (ctx.allowedSiteIds === "ALL") return;
  if (!ctx.allowedSiteIds.includes(siteId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "FORBIDDEN_SITE" });
  }
}
