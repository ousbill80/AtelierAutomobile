// 04-arbitrages A2 / M14 §4.1 — mécanisme unique des liens publics : `PortalToken` (jeton clair
// jamais stocké, seul son sha256 l'est). Tous les points d'entrée du portail (RDV, suivi d'OR,
// devis, facture, véhicule, avis) résolvent leur jeton ici : portée stricte, expiration,
// révocation, compteur d'ouvertures et journal `PortalAccess` (RG-M14-06).
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { PortalScope, PortalToken, Prisma } from "@prisma/client";
import {
  effectiveTokenState,
  ipPrefix,
  isPortalTokenShape,
  portalAccessPurgeBefore,
  shortCodeFromBytes,
  truncateUserAgent,
  type PortalAccessAction,
} from "@atelieros/core/portal";
import { adminDb } from "./client";
import { db } from "./tenant";

/** Sous-ensemble structurel commun à `db.forTenant(ctx)` et au client de `.transaction()`. */
interface PortalTokenWriter {
  portalToken: {
    create(args: { data: Prisma.PortalTokenUncheckedCreateInput }): Promise<{ id: string }>;
  };
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** RG-M14-01 : 32 octets aléatoires en base64url (43 caractères). */
export function generatePortalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPortalToken(token) };
}

/** RG-M14-05 : alias court SMS (8 caractères base62). */
export function generateShortCode(): string {
  return shortCodeFromBytes(randomBytes(8));
}

/**
 * Jeton « enfant » déterministe : un jeton REPAIR_ORDER (ou une session « Mon espace ») ouvre
 * le devis ou la facture de son OR sans exposer d'identifiant interne ni multiplier les jetons :
 * le même parent produit toujours le même enfant pour la même ressource (RG-M14-02).
 */
export function derivePortalToken(parentToken: string, label: string): string {
  return createHmac("sha256", parentToken).update(`atelieros-portal:${label}`).digest("base64url");
}

function shortLinkSecret(): string {
  const secret = process.env.PORTAL_LINK_SECRET ?? process.env.AUTH_SECRET;
  if (!secret)
    throw new Error("PORTAL_LINK_SECRET (ou AUTH_SECRET) est requis pour les liens courts.");
  return secret;
}

/**
 * RG-M14-05 — jeton d'un lien court : dérivé de l'alias par HMAC avec le secret serveur, pour que
 * `/l/{code}` puisse rediriger (302) vers `/p/{jeton}` sans jamais stocker le jeton clair.
 * Deviner un alias reste limité par le blocage des IP après 5 liens invalides (RG-M14-06).
 */
export function tokenForShortCode(code: string): string {
  return createHmac("sha256", shortLinkSecret())
    .update(`atelieros-short:${code}`)
    .digest("base64url");
}

export interface IssuePortalTokenInput {
  organizationId: string;
  scope: PortalScope;
  targetId: string;
  customerId: string;
  expiresAt: Date;
  reminderId?: string | null;
  createdById?: string | null;
  /** Ajoute un alias court `/l/{code}` (liens envoyés par SMS) ; ignoré pour un jeton imposé. */
  withShortCode?: boolean;
  /** Jeton clair imposé (jeton dérivé) ; sinon 32 octets aléatoires. */
  token?: string;
}

/** Crée un jeton et renvoie sa valeur claire (à mettre dans le lien), avec son hash. */
export async function issuePortalToken(
  tx: PortalTokenWriter,
  input: IssuePortalTokenInput,
): Promise<{ token: string; tokenHash: string; id: string; shortCode: string | null }> {
  const shortCode = input.withShortCode && !input.token ? generateShortCode() : null;
  const token =
    input.token ?? (shortCode ? tokenForShortCode(shortCode) : generatePortalToken().token);
  const tokenHash = hashPortalToken(token);
  const row = await tx.portalToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash,
      shortCode,
      scope: input.scope,
      targetId: input.targetId,
      customerId: input.customerId,
      expiresAt: input.expiresAt,
      reminderId: input.reminderId ?? null,
      createdById: input.createdById ?? null,
    },
  });
  return { token, tokenHash, id: row.id, shortCode };
}

export interface PortalAccessContext {
  action: PortalAccessAction;
  ip?: string | null;
  userAgent?: string | null;
}

/** RG-M14-06 — journalise une ouverture ou une action (IP tronquée, user-agent tronqué). */
export async function logPortalAccess(input: {
  organizationId: string;
  portalTokenId?: string | null;
  portalSessionId?: string | null;
  access: PortalAccessContext;
}): Promise<void> {
  await db.forTenant({ organizationId: input.organizationId }).portalAccess.create({
    data: {
      organizationId: input.organizationId,
      portalTokenId: input.portalTokenId ?? null,
      portalSessionId: input.portalSessionId ?? null,
      action: input.access.action,
      ipPrefix: ipPrefix(input.access.ip),
      userAgent: truncateUserAgent(input.access.userAgent),
    },
  });
}

export type ResolvedPortalToken =
  | { status: "ACTIVE"; row: PortalToken }
  | { status: "EXPIRED" | "REVOKED"; row: PortalToken }
  | { status: "NOT_FOUND" };

export interface ResolvePortalTokenOptions {
  /**
   * Compte une ouverture (compteur + `PortalAccess` « open »). Faux pour un rafraîchissement
   * (statut de paiement, flux temps réel) ; défaut : vrai.
   */
  count?: boolean;
  /** Journal de l'ouverture ou de l'action (IP, user-agent). */
  access?: PortalAccessContext;
}

/**
 * Résout un jeton public (hors contexte locataire : c'est lui qui le fournit). Un jeton d'une
 * autre portée est introuvable (RG-M14-02). Un jeton expiré est marqué EXPIRED à la première
 * lecture. Les états EXPIRED/REVOKED renvoient la ligne (renvoi de lien, message adapté) :
 * l'appelant ne doit jamais en lire la cible.
 */
export async function resolvePortalToken(
  token: string,
  scopes: readonly PortalScope[],
  now: Date,
  options: ResolvePortalTokenOptions = {},
): Promise<ResolvedPortalToken> {
  if (!isPortalTokenShape(token)) return { status: "NOT_FOUND" };
  const row = await adminDb.portalToken.findUnique({
    where: { tokenHash: hashPortalToken(token) },
  });
  if (!row || !scopes.includes(row.scope)) return { status: "NOT_FOUND" };
  const state = effectiveTokenState(row, now);
  if (state === "REVOKED") return { status: "REVOKED", row };
  if (state === "EXPIRED") {
    if (row.status !== "EXPIRED") {
      await adminDb.portalToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    }
    return { status: "EXPIRED", row };
  }
  if (options.count === false) {
    if (options.access) {
      await logPortalAccess({
        organizationId: row.organizationId,
        portalTokenId: row.id,
        access: options.access,
      });
    }
    return { status: "ACTIVE", row };
  }
  const updated = await adminDb.portalToken.update({
    where: { id: row.id },
    data: {
      openCount: { increment: 1 },
      lastOpenedAt: now,
      firstOpenedAt: row.firstOpenedAt ?? now,
    },
  });
  await logPortalAccess({
    organizationId: row.organizationId,
    portalTokenId: row.id,
    access: options.access ?? { action: "open" },
  });
  return { status: "ACTIVE", row: updated };
}

/** Recherche brute d'un jeton par sa valeur claire (renvoi de lien, alias court). */
export async function findPortalTokenByShortCode(code: string): Promise<PortalToken | null> {
  return adminDb.portalToken.findUnique({ where: { shortCode: code } });
}

/** Sous-ensemble structurel pour révoquer (client locataire ou transaction). */
interface PortalTokenRevoker {
  portalToken: {
    updateMany(args: {
      where: Prisma.PortalTokenWhereInput;
      data: Prisma.PortalTokenUncheckedUpdateManyInput;
    }): Promise<{ count: number }>;
  };
}

/** RG-M14-04 — révocation des jetons actifs d'une ressource (manuelle ou automatique). */
export async function revokePortalTokensFor(
  tx: PortalTokenRevoker,
  input: { scopes: readonly PortalScope[]; targetId: string; reason: string; now: Date },
): Promise<number> {
  const out = await tx.portalToken.updateMany({
    where: { scope: { in: [...input.scopes] }, targetId: input.targetId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: input.now, revokeReason: input.reason },
  });
  return out.count;
}

/**
 * Tâche `portal.tokens_expire` (M14 §9) : passe EXPIRED les jetons échus, ferme les sessions et
 * défis OTP échus, purge le journal `PortalAccess` de plus de 12 mois. Balayage
 * inter-organisations (job système), sans lecture de données client.
 */
export async function expirePortalTokens(
  now: Date,
  scope: { organizationId?: string } = {},
): Promise<{
  expired: number;
  purgedAccesses: number;
  purgedChallenges: number;
}> {
  const org = scope.organizationId ? { organizationId: scope.organizationId } : {};
  const expired = await adminDb.portalToken.updateMany({
    where: { ...org, status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  const purgedAccesses = await adminDb.portalAccess.deleteMany({
    where: { ...org, createdAt: { lt: portalAccessPurgeBefore(now) } },
  });
  const purgedChallenges = await adminDb.portalOtpChallenge.deleteMany({
    where: { ...org, expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
  });
  return {
    expired: expired.count,
    purgedAccesses: purgedAccesses.count,
    purgedChallenges: purgedChallenges.count,
  };
}
