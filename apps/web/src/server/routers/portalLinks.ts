// M14 §7 / §8 — back-office : bloc « Lien client » (liste des liens d'une ressource avec dernière
// ouverture et nombre d'ouvertures, création, envoi au client, révocation avec motif et audit),
// et liste des avis clients. Permissions selon la portée (M14 §10, `portalLinkPermissions`).
import { TRPCError } from "@trpc/server";
import {
  effectiveTokenState,
  newLinkMessage,
  portalLinkPermissions,
  type Permission,
  type PortalScopeKey,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import {
  feedbackListInputSchema,
  portalLinksCreateInputSchema,
  portalLinksListInputSchema,
  portalLinksRevokeInputSchema,
} from "@atelieros/validators";
import { writeAuditLog } from "../audit";
import { createPortalLink, loadLinkTarget, sendLinkToCustomer } from "../portal/links";
import { portalNow } from "../portal/access";
import { orgProcedure, requirePermission, router } from "../trpc";

function assertPermissions(ctx: { permissions: Set<Permission> }, perms: Permission[]) {
  const missing = perms.filter((p) => !ctx.permissions.has(p));
  if (missing.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Permission manquante : ${missing.join(", ")}`,
    });
  }
}

export const portalLinksRouter = router({
  /** Liens d'une ressource : état, ouvertures (le clair n'est jamais renvoyé : il n'est pas stocké). */
  list: orgProcedure.input(portalLinksListInputSchema).query(async ({ ctx, input }) => {
    assertPermissions(ctx, portalLinkPermissions(input.scope).read);
    const now = portalNow();
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.portalToken.findMany({
      where: { scope: input.scope, targetId: input.targetId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        firstOpenedAt: true,
        lastOpenedAt: true,
        openCount: true,
        revokedAt: true,
        revokeReason: true,
        createdById: true,
        reminderId: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      state: effectiveTokenState(r, now),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      firstOpenedAt: r.firstOpenedAt,
      lastOpenedAt: r.lastOpenedAt,
      openCount: r.openCount,
      revokedAt: r.revokedAt,
      revokeReason: r.revokeReason,
      origin: r.reminderId ? "reminder" : r.createdById ? "staff" : "automatic",
    }));
  }),

  /** Nouveau lien (URL complète + alias court SMS) : à copier ou à envoyer. */
  create: orgProcedure.input(portalLinksCreateInputSchema).mutation(async ({ ctx, input }) => {
    assertPermissions(ctx, portalLinkPermissions(input.scope).write);
    const link = await createPortalLink({
      organizationId: ctx.organizationId,
      scope: input.scope,
      targetId: input.targetId,
      createdById: ctx.membership.id,
      now: portalNow(),
    });
    if (!link) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Impossible de créer un lien : la ressource est introuvable, annulée ou en brouillon.",
      });
    }
    return link;
  }),

  /** Crée un lien et l'envoie au numéro enregistré du client (WhatsApp, repli SMS). */
  send: orgProcedure.input(portalLinksCreateInputSchema).mutation(async ({ ctx, input }) => {
    assertPermissions(ctx, [...portalLinkPermissions(input.scope).write, "message:send"]);
    const now = portalNow();
    const link = await createPortalLink({
      organizationId: ctx.organizationId,
      scope: input.scope,
      targetId: input.targetId,
      createdById: ctx.membership.id,
      now,
    });
    if (!link) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Impossible de créer un lien : la ressource est introuvable, annulée ou en brouillon.",
      });
    }
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const target = await loadLinkTarget(tenantDb, input.scope as PortalScopeKey, input.targetId);
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true },
    });
    const sent = target
      ? await sendLinkToCustomer({
          organizationId: ctx.organizationId,
          customerId: target.customerId,
          body: newLinkMessage(org.name, link.shortUrl ?? link.url),
          idempotencyKey: `portal:link:${link.id}`,
          sentById: ctx.membership.id,
        })
      : false;
    if (!sent) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Le client n'a pas de numéro joignable (WhatsApp ou SMS) : copiez le lien et transmettez-le autrement.",
      });
    }
    return { ...link, sent: true };
  }),

  /** RG-M14-04 — révocation manuelle, motif obligatoire, audit. */
  revoke: orgProcedure.input(portalLinksRevokeInputSchema).mutation(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const row = await tenantDb.portalToken.findFirst({ where: { id: input.id } });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Lien introuvable." });
    assertPermissions(ctx, portalLinkPermissions(row.scope).write);
    if (row.status === "REVOKED") return { ok: true };
    const now = portalNow();
    await tenantDb.portalToken.update({
      where: { id: row.id },
      data: { status: "REVOKED", revokedAt: now, revokeReason: input.reason },
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "portal.token_revoked",
      entity: "PortalToken",
      entityId: row.id,
      before: { status: row.status },
      after: { status: "REVOKED", scope: row.scope, targetId: row.targetId },
      reason: input.reason,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { ok: true };
  }),
});

export const feedbackRouter = router({
  /** `/clients/avis` — avis récents, filtre par note, moyenne sur 30 jours. */
  list: requirePermission("customer:read")
    .input(feedbackListInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const since = new Date(portalNow().getTime() - 30 * 86_400_000);
      const [rows, last30] = await Promise.all([
        tenantDb.customerFeedback.findMany({
          where: input.rating ? { rating: input.rating } : {},
          orderBy: { createdAt: "desc" },
          take: input.limit,
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            customer: { select: { id: true, displayName: true } },
            repairOrder: { select: { id: true, number: true } },
          },
        }),
        tenantDb.customerFeedback.aggregate({
          where: { createdAt: { gte: since } },
          _avg: { rating: true },
          _count: { _all: true },
        }),
      ]);
      return {
        items: rows,
        average30d: last30._avg.rating,
        count30d: last30._count._all,
      };
    }),
});
