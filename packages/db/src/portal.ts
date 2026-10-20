// 04-arbitrages A2 — mécanisme unique des liens publics : `PortalToken` (jeton clair jamais
// stocké, seul son sha256 l'est). Utilisé par M03 (lien RDV) en attendant le module M14, qui
// reprendra ces fonctions derrière `portal.createToken` / `portal.revokeToken`.
import { createHash, randomBytes } from "node:crypto";
import type { PortalScope, Prisma } from "@prisma/client";
import { adminDb } from "./client";

/** Sous-ensemble structurel commun à `db.forTenant(ctx)` et au client de `.transaction()`. */
interface PortalTokenWriter {
  portalToken: {
    create(args: { data: Prisma.PortalTokenUncheckedCreateInput }): Promise<{ id: string }>;
  };
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuePortalTokenInput {
  organizationId: string;
  scope: PortalScope;
  targetId: string;
  customerId: string;
  expiresAt: Date;
  reminderId?: string | null;
  createdById?: string | null;
}

/** Crée un jeton et renvoie sa valeur claire (à mettre dans le lien), avec son hash. */
export async function issuePortalToken(
  tx: PortalTokenWriter,
  input: IssuePortalTokenInput,
): Promise<{ token: string; tokenHash: string; id: string }> {
  const token = randomBytes(24).toString("base64url");
  const tokenHash = hashPortalToken(token);
  const row = await tx.portalToken.create({
    data: {
      organizationId: input.organizationId,
      tokenHash,
      scope: input.scope,
      targetId: input.targetId,
      customerId: input.customerId,
      expiresAt: input.expiresAt,
      reminderId: input.reminderId ?? null,
      createdById: input.createdById ?? null,
    },
  });
  return { token, tokenHash, id: row.id };
}

export type ResolvedPortalToken =
  | {
      status: "ACTIVE";
      row: NonNullable<Awaited<ReturnType<typeof adminDb.portalToken.findUnique>>>;
    }
  | { status: "EXPIRED" | "REVOKED" | "NOT_FOUND" };

/**
 * Résout un jeton public (hors contexte locataire : c'est lui qui le fournit). Compte
 * l'ouverture. Un jeton expiré est marqué EXPIRED à la première lecture.
 */
export async function resolvePortalToken(
  token: string,
  scopes: readonly PortalScope[],
  now: Date,
): Promise<ResolvedPortalToken> {
  const row = await adminDb.portalToken.findUnique({
    where: { tokenHash: hashPortalToken(token) },
  });
  if (!row || !scopes.includes(row.scope)) return { status: "NOT_FOUND" };
  if (row.status === "REVOKED") return { status: "REVOKED" };
  if (row.status === "EXPIRED" || row.expiresAt.getTime() <= now.getTime()) {
    if (row.status !== "EXPIRED") {
      await adminDb.portalToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    }
    return { status: "EXPIRED" };
  }
  const updated = await adminDb.portalToken.update({
    where: { id: row.id },
    data: {
      openCount: { increment: 1 },
      lastOpenedAt: now,
      firstOpenedAt: row.firstOpenedAt ?? now,
    },
  });
  return { status: "ACTIVE", row: updated };
}
