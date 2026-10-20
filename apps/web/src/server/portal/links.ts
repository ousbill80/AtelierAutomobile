// M14 §4.1 / §8 — cycle de vie des liens : création par le personnel (`portalLinks.create`,
// réutilisation impossible : le clair n'est jamais stocké, un nouveau jeton est émis), renvoi à
// la demande du client (« Recevoir un nouveau lien », RG-M14-03 : au numéro enregistré, 3/jour),
// révocation (RG-M14-04).
import {
  canRequestNewLink,
  newLinkMessage,
  portalPathFor,
  portalTokenExpiry,
  renewedTokenExpiry,
  type PortalExpiryRefs,
  type PortalScopeKey,
} from "@atelieros/core";
import {
  adminDb,
  db,
  derivePortalToken,
  hashPortalToken,
  issuePortalToken,
  logPortalAccess,
  PortalScope,
  resolvePortalToken,
  type PortalToken,
} from "@atelieros/db";
import { messagingEnqueue } from "../messaging/enqueue";
import { enqueueMessageSendJob } from "../messaging/queue";
import { appUrl } from "../repairOrders/helpers";
import { recordInvalidPortalToken } from "./rateLimit";
import { guardPortalRequest, linkError, type PortalRequestCtx } from "./access";

type TenantDb = ReturnType<typeof db.forTenant>;

export interface LinkTarget {
  customerId: string;
  refs: Omit<PortalExpiryRefs, "now">;
  /** La ressource accepte encore un lien (facture non annulée, RDV non annulé…). */
  linkable: boolean;
}

/** Charge la cible d'une portée (sous RLS) : client, dates d'expiration, état. */
export async function loadLinkTarget(
  tenantDb: TenantDb,
  scope: PortalScopeKey,
  targetId: string,
): Promise<LinkTarget | null> {
  switch (scope) {
    case "QUOTE": {
      const q = await tenantDb.quote.findFirst({
        where: { id: targetId },
        select: { customerId: true, validUntil: true, deletedAt: true, status: true },
      });
      return q
        ? {
            customerId: q.customerId,
            refs: { validUntil: q.validUntil },
            linkable: !q.deletedAt && q.status !== "DRAFT",
          }
        : null;
    }
    case "INVOICE": {
      const inv = await tenantDb.invoice.findFirst({
        where: { id: targetId },
        select: { customerId: true, issuedAt: true, status: true },
      });
      return inv
        ? {
            customerId: inv.customerId,
            refs: { issuedAt: inv.issuedAt },
            linkable: inv.status !== "DRAFT" && inv.status !== "VOID",
          }
        : null;
    }
    case "REPAIR_ORDER":
    case "SURVEY": {
      const ro = await tenantDb.repairOrder.findFirst({
        where: { id: targetId },
        select: { customerId: true, deliveredAt: true, status: true },
      });
      if (!ro) return null;
      return {
        customerId: ro.customerId,
        refs: scope === "REPAIR_ORDER" ? { deliveredAt: ro.deliveredAt } : {},
        // Un avis ne se donne qu'après la restitution (US-M14-11).
        linkable: scope === "SURVEY" ? ro.status === "DELIVERED" || ro.status === "INVOICED" : true,
      };
    }
    case "APPOINTMENT": {
      const a = await tenantDb.appointment.findFirst({
        where: { id: targetId },
        select: { customerId: true, startsAt: true, status: true },
      });
      return a
        ? {
            customerId: a.customerId,
            refs: { startsAt: a.startsAt },
            linkable: a.status !== "CANCELLED",
          }
        : null;
    }
    case "VEHICLE": {
      const v = await tenantDb.vehicle.findFirst({
        where: { id: targetId },
        select: { customerId: true, deletedAt: true },
      });
      return v ? { customerId: v.customerId, refs: {}, linkable: !v.deletedAt } : null;
    }
    case "BOOKING": {
      // Cible = véhicule ou client (M03 issueBookingLink).
      const v = await tenantDb.vehicle.findFirst({
        where: { id: targetId },
        select: { customerId: true },
      });
      if (v) return { customerId: v.customerId, refs: {}, linkable: true };
      const c = await tenantDb.customer.findFirst({
        where: { id: targetId },
        select: { id: true },
      });
      return c ? { customerId: c.id, refs: {}, linkable: true } : null;
    }
    case "STATEMENT": {
      const c = await tenantDb.customer.findFirst({
        where: { id: targetId },
        select: { id: true },
      });
      return c ? { customerId: c.id, refs: {}, linkable: true } : null;
    }
  }
}

export function portalUrl(token: string, scope: PortalScopeKey): string {
  return `${appUrl()}/p/${token}/${portalPathFor(scope)}`;
}

export function shortUrl(code: string | null): string | null {
  return code ? `${appUrl()}/l/${code}` : null;
}

/** Hash renseigné dans `publicToken` de la cible (A2 : raccourci de recherche). */
async function syncPublicToken(
  tenantDb: TenantDb,
  scope: PortalScopeKey,
  targetId: string,
  tokenHash: string,
) {
  if (scope === "QUOTE") {
    await tenantDb.quote.update({ where: { id: targetId }, data: { publicToken: tokenHash } });
  } else if (scope === "INVOICE") {
    await tenantDb.invoice.update({ where: { id: targetId }, data: { publicToken: tokenHash } });
  } else if (scope === "REPAIR_ORDER") {
    await tenantDb.repairOrder.update({
      where: { id: targetId },
      data: { publicToken: tokenHash },
    });
  } else if (scope === "APPOINTMENT") {
    await tenantDb.appointment.update({
      where: { id: targetId },
      data: { publicToken: tokenHash },
    });
  }
}

/** `portalLinks.create` — nouveau jeton (avec alias court) pour une ressource de l'organisation. */
export async function createPortalLink(input: {
  organizationId: string;
  scope: PortalScopeKey;
  targetId: string;
  createdById: string | null;
  now: Date;
  renewal?: boolean;
}): Promise<{ id: string; url: string; shortUrl: string | null; expiresAt: Date } | null> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const target = await loadLinkTarget(tenantDb, input.scope, input.targetId);
  if (!target || !target.linkable) return null;
  const refs = { now: input.now, ...target.refs };
  const expiresAt = input.renewal
    ? renewedTokenExpiry(input.scope, refs)
    : portalTokenExpiry(input.scope, refs);
  return tenantDb.transaction(async (tx) => {
    const issued = await issuePortalToken(tx, {
      organizationId: input.organizationId,
      scope: input.scope as PortalScope,
      targetId: input.targetId,
      customerId: target.customerId,
      expiresAt,
      createdById: input.createdById,
      withShortCode: true,
    });
    await syncPublicToken(tx as unknown as TenantDb, input.scope, input.targetId, issued.tokenHash);
    return {
      id: issued.id,
      url: portalUrl(issued.token, input.scope),
      shortUrl: shortUrl(issued.shortCode),
      expiresAt,
    };
  });
}

/** Envoie un lien au numéro **enregistré** du client (WhatsApp, repli SMS) — jamais à un numéro saisi. */
export async function sendLinkToCustomer(input: {
  organizationId: string;
  customerId: string;
  body: string;
  idempotencyKey: string;
  sentById?: string | null;
}): Promise<boolean> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const customer = await tenantDb.customer.findFirst({
    where: { id: input.customerId, deletedAt: null },
    select: { id: true, phone: true, whatsappPhone: true, displayName: true },
  });
  if (!customer || (!customer.phone && !customer.whatsappPhone)) return false;
  const result = await tenantDb.transaction((tx) =>
    messagingEnqueue(tx, input.organizationId, {
      idempotencyKey: input.idempotencyKey,
      kind: "transactional",
      customerId: customer.id,
      to: {
        phone: customer.phone,
        whatsapp: customer.whatsappPhone ?? customer.phone,
        name: customer.displayName,
      },
      channels: ["WHATSAPP", "SMS"],
      bodyOverride: input.body,
      sentById: input.sentById ?? null,
    }),
  );
  if (!("message" in result)) return false;
  await enqueueMessageSendJob(result.message.id).catch(() => undefined);
  return true;
}

/**
 * Jeton « enfant » d'un jeton parent (OR → devis/facture, véhicule → facture/OR, session « Mon
 * espace » → document) : dérivé du clair du parent, donc stable et sans identifiant interne
 * exposé. Créé à la première ouverture, réactivé s'il a seulement expiré ; un enfant révoqué
 * (facture annulée) reste révoqué.
 */
export async function ensureChildToken(input: {
  parentToken: string;
  organizationId: string;
  scope: PortalScopeKey;
  targetId: string;
  customerId: string;
  refs: Omit<PortalExpiryRefs, "now">;
  now: Date;
}): Promise<{ url: string }> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const childToken = derivePortalToken(input.parentToken, `${input.scope}:${input.targetId}`);
  const tokenHash = hashPortalToken(childToken);
  const refs = { now: input.now, ...input.refs };
  const existing = await tenantDb.portalToken.findFirst({ where: { tokenHash } });
  if (existing?.status === "REVOKED") linkError("REVOKED", existing.revokeReason);
  if (!existing) {
    await issuePortalToken(tenantDb, {
      organizationId: input.organizationId,
      scope: input.scope as PortalScope,
      targetId: input.targetId,
      customerId: input.customerId,
      expiresAt: portalTokenExpiry(input.scope, refs),
      createdById: null,
      token: childToken,
    });
  } else if (existing.status === "EXPIRED" || existing.expiresAt.getTime() <= input.now.getTime()) {
    await tenantDb.portalToken.update({
      where: { id: existing.id },
      data: { status: "ACTIVE", expiresAt: renewedTokenExpiry(input.scope, refs) },
    });
  }
  return { url: portalUrl(childToken, input.scope) };
}

const ALL_SCOPES = Object.values(PortalScope);

/**
 * `portal.requestNewLink` — réponse toujours `{ ok: true }` (rien n'est révélé). Seul un jeton
 * EXPIRÉ donne lieu à un renvoi ; un jeton révoqué ou inconnu ne renvoie rien.
 */
export async function requestNewLink(
  token: string,
  ctx: PortalRequestCtx,
  now: Date,
): Promise<{ ok: true }> {
  await guardPortalRequest(ctx, now);
  const resolved = await resolvePortalToken(token, ALL_SCOPES, now, { count: false });
  if (resolved.status === "NOT_FOUND") {
    await recordInvalidPortalToken(ctx.ip, now);
    return { ok: true };
  }
  if (resolved.status !== "EXPIRED") return { ok: true };
  const row: PortalToken = resolved.row;
  const tenantDb = db.forTenant({ organizationId: row.organizationId });
  const since = new Date(now.getTime() - 86_400_000);
  const recent = await tenantDb.portalAccess.count({
    where: {
      action: "new_link_request",
      createdAt: { gte: since },
      portalToken: { customerId: row.customerId, targetId: row.targetId },
    },
  });
  await logPortalAccess({
    organizationId: row.organizationId,
    portalTokenId: row.id,
    access: { action: "new_link_request", ip: ctx.ip, userAgent: ctx.userAgent },
  });
  if (!canRequestNewLink(recent)) return { ok: true };
  const link = await createPortalLink({
    organizationId: row.organizationId,
    scope: row.scope,
    targetId: row.targetId,
    createdById: null,
    now,
    renewal: true,
  });
  if (!link) return { ok: true };
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: row.organizationId },
    select: { name: true },
  });
  await sendLinkToCustomer({
    organizationId: row.organizationId,
    customerId: row.customerId,
    body: newLinkMessage(org.name, link.shortUrl ?? link.url),
    idempotencyKey: `portal:newlink:${link.id}`,
  });
  return { ok: true };
}
