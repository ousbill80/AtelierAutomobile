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
  // Erreur de validation d'entrée (Zod) : `message` devient une phrase française lisible
  // (au lieu du tableau JSON brut) et le détail par champ est exposé dans `data.zodError`.
  errorFormatter({ shape, error }) {
    const cause = error.cause;
    const zod = isZodErrorLike(cause) ? cause : null;
    return {
      ...shape,
      message: zod ? readableZodMessage(zod) : shape.message,
      data: {
        ...shape.data,
        domainCode: isDomainError(cause) ? cause.code : null,
        domainDetails: isDomainError(cause) ? (cause.details ?? null) : null,
        zodError: zod ? zod.flatten() : null,
      },
    };
  },
});

interface ZodIssueLike {
  code: string;
  path: (string | number)[];
  message: string;
  type?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  received?: string;
}
interface ZodErrorLike {
  issues: ZodIssueLike[];
  flatten: () => { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };
}

/** Duck typing : `validators` et l'app peuvent embarquer deux copies de Zod (instanceof peu fiable). */
function isZodErrorLike(value: unknown): value is ZodErrorLike {
  return (
    value instanceof Error &&
    value.name === "ZodError" &&
    Array.isArray((value as unknown as ZodErrorLike).issues) &&
    typeof (value as unknown as ZodErrorLike).flatten === "function"
  );
}

/** Messages Zod par défaut (anglais) : on les remplace ; un message personnalisé est déjà en français. */
const ZOD_DEFAULT_MESSAGE =
  /^(Required|Invalid|Expected|String must|Number must|Array must|Too (small|big)|Unrecognized)/;

function frenchZodIssue(issue: ZodIssueLike): string {
  const n = (v: number | bigint | undefined) => (v === undefined ? "" : String(v));
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null"
        ? "valeur obligatoire."
        : "type de valeur invalide.";
    case "too_small":
      if (issue.type === "string")
        return Number(issue.minimum) <= 1
          ? "ne peut pas être vide."
          : `${n(issue.minimum)} caractères minimum.`;
      if (issue.type === "array") return `${n(issue.minimum)} élément(s) minimum.`;
      return `doit être au moins ${n(issue.minimum)}.`;
    case "too_big":
      if (issue.type === "string") return `${n(issue.maximum)} caractères maximum.`;
      if (issue.type === "array") return `${n(issue.maximum)} élément(s) maximum.`;
      return `doit être au plus ${n(issue.maximum)}.`;
    case "invalid_enum_value":
    case "invalid_union_discriminator":
    case "invalid_literal":
      return "valeur non autorisée.";
    case "invalid_string":
      return "format invalide.";
    default:
      return "valeur invalide.";
  }
}

function readableZodMessage(error: ZodErrorLike): string {
  const issue = error.issues[0];
  if (!issue) return "Données invalides.";
  if (issue.message && !ZOD_DEFAULT_MESSAGE.test(issue.message)) return issue.message;
  const path = issue.path.join(".");
  const text = frenchZodIssue(issue);
  return path ? `Champ « ${path} » : ${text}` : `Données invalides : ${text}`;
}

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
