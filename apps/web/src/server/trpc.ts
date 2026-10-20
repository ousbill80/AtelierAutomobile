import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import {
  isDomainError,
  isMutationAllowedInLifecycle,
  readOnlyMessage,
  type OrgLifecycleStatus,
  type Permission,
} from "@atelieros/core";
import { adminDb } from "@atelieros/db";
import type { Ctx, CtxMembership, CtxSession, CtxUser } from "./context";

const t = initTRPC.context<Ctx>().create({
  transformer: superjson,
  // Code métier (`DomainError.code`) exposé au client quand une procédure lève une erreur
  // dont la cause est une DomainError — ex. M03 : SLOT_CONFLICT, DUPLICATE_SAME_DAY (forçables).
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        domainCode: isDomainError(cause) ? cause.code : null,
        domainDetails: isDomainError(cause) ? (cause.details ?? null) : null,
      },
    };
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
  return orgProcedure.use(async ({ ctx, next, type, path }) => {
    const missing = perms.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permission manquante : ${missing.join(", ")}`,
      });
    }
    if (type === "mutation") {
      await assertWritableLifecycle(ctx.organizationId, path);
    }
    return next({ ctx });
  });
}

/**
 * M15 RG-M15-22 / §5 — suppression programmée ou compte suspendu : lecture seule. Seules
 * l'annulation de la suppression et l'export des données restent possibles en écriture.
 */
export async function assertWritableLifecycle(organizationId: string, path: string) {
  const org = await adminDb.organization.findUnique({
    where: { id: organizationId },
    select: { lifecycleStatus: true },
  });
  const status = (org?.lifecycleStatus ?? "ACTIVE") as OrgLifecycleStatus;
  if (!isMutationAllowedInLifecycle(status, path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: readOnlyMessage(status) });
  }
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
