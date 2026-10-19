import { createHash, randomBytes } from "node:crypto";
import { adminDb, db, type PortalScope } from "@atelieros/db";

/** RG-M14-01 — jeton : 32 octets aléatoires en base64url, stocké haché (sha256). */
export function generatePortalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashPortalToken(token) };
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function portalUrl(token: string, path: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/p/${token}/${path.replace(/^\//, "")}`;
}

/** RG-M14-03 — expirations par défaut (jours) des portées utilisées par M03. */
export const PORTAL_TOKEN_DEFAULT_DAYS: Partial<Record<PortalScope, number>> = {
  BOOKING: 30,
  APPOINTMENT: 1, // startsAt + 1 j, calculé par l'appelant
};

export interface CreatePortalLinkInput {
  organizationId: string;
  scope: PortalScope;
  targetId: string;
  customerId: string;
  expiresAt: Date;
  createdById?: string | null;
  reminderId?: string | null;
}

/**
 * Crée un `PortalToken` (A2 : mécanisme unique des liens publics). Le clair n'existe que dans
 * l'URL renvoyée. Un jeton actif existant pour la même cible et la même portée est réutilisé
 * s'il est encore valable… mais son clair est perdu : on en crée alors un nouveau et on révoque
 * l'ancien (un seul lien actif par cible).
 */
export async function createPortalLink(
  input: CreatePortalLinkInput,
): Promise<{ token: string; tokenHash: string; url: string; id: string }> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  await tenantDb.portalToken.updateMany({
    where: { scope: input.scope, targetId: input.targetId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: new Date(), revokeReason: "Nouveau lien émis" },
  });
  const { token, tokenHash } = generatePortalToken();
  const row = await tenantDb.portalToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash,
      scope: input.scope,
      targetId: input.targetId,
      customerId: input.customerId,
      expiresAt: input.expiresAt,
      createdById: input.createdById ?? null,
      reminderId: input.reminderId ?? null,
    },
    select: { id: true },
  });
  const path = input.scope === "BOOKING" || input.scope === "APPOINTMENT" ? "rdv" : "";
  return { token, tokenHash, url: portalUrl(token, path), id: row.id };
}

export type PortalTokenResolution =
  | { ok: true; token: NonNullable<Awaited<ReturnType<typeof adminDb.portalToken.findUnique>>> }
  | { ok: false; reason: "NOT_FOUND" | "EXPIRED" | "REVOKED" };

/**
 * Résout un jeton clair (page publique, hors session) : `adminDb` car il n'y a pas d'organisation
 * active ; la portée du jeton limite ensuite strictement les données accessibles (RG-M14-02).
 */
export async function resolvePortalToken(
  token: string,
  now: Date = new Date(),
): Promise<PortalTokenResolution> {
  const row = await adminDb.portalToken.findUnique({
    where: { tokenHash: hashPortalToken(token) },
  });
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  if (row.status === "REVOKED") return { ok: false, reason: "REVOKED" };
  if (row.status === "EXPIRED" || row.expiresAt < now) {
    if (row.status !== "EXPIRED") {
      await adminDb.portalToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    }
    return { ok: false, reason: "EXPIRED" };
  }
  await adminDb.portalToken.update({
    where: { id: row.id },
    data: {
      openCount: { increment: 1 },
      lastOpenedAt: now,
      firstOpenedAt: row.firstOpenedAt ?? now,
    },
  });
  return { ok: true, token: row };
}
