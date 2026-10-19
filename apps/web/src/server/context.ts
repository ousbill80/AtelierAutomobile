import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { adminDb, db } from "@atelieros/db";
import { isSessionExpired, resolvePermissions, type Permission, type Role } from "@atelieros/core";

export const SESSION_COOKIE_NAME = "atelieros_session";

export interface CtxUser {
  id: string;
  name: string;
}

export interface CtxSession {
  id: string;
  token: string;
  activeOrganizationId: string | null;
  activeSiteId: string | null;
  isPinSession: boolean;
}

export interface CtxMembership {
  id: string;
  role: Role;
  siteIds: string[];
}

export interface Ctx {
  resHeaders: Headers;
  user: CtxUser | null;
  session: CtxSession | null;
  membership: CtxMembership | null;
  permissions: Set<Permission>;
  allowedSiteIds: string[] | "ALL";
  ip: string;
  userAgent: string;
  /** En-tête x-org-id envoyé par le client, comparé à la session active (US-M01-10). */
  orgHeaderId?: string | null;
}

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return null;
}

function clientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]!.trim();
  }
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

export async function createContext({
  req,
  resHeaders,
}: FetchCreateContextFnOptions): Promise<Ctx> {
  const emptyCtx: Ctx = {
    resHeaders,
    user: null,
    session: null,
    membership: null,
    permissions: new Set(),
    allowedSiteIds: [],
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? "",
    orgHeaderId: req.headers.get("x-org-id"),
  };

  const token = parseCookie(req.headers.get("cookie"), SESSION_COOKIE_NAME);
  if (!token) {
    return emptyCtx;
  }

  const sessionRow = await adminDb.session.findUnique({ where: { token } });
  if (!sessionRow) {
    return emptyCtx;
  }

  const now = new Date();
  if (
    isSessionExpired(
      {
        createdAt: sessionRow.createdAt,
        lastActiveAt: sessionRow.lastActiveAt,
        isPinSession: sessionRow.isPinSession,
      },
      now,
    )
  ) {
    return emptyCtx;
  }

  const userRow = await adminDb.user.findUnique({ where: { id: sessionRow.userId } });
  if (!userRow || !userRow.isActive) {
    return emptyCtx;
  }

  const ctx: Ctx = {
    ...emptyCtx,
    user: { id: userRow.id, name: userRow.name },
    session: {
      id: sessionRow.id,
      token: sessionRow.token,
      activeOrganizationId: sessionRow.activeOrganizationId,
      activeSiteId: sessionRow.activeSiteId,
      isPinSession: sessionRow.isPinSession,
    },
  };

  if (!sessionRow.activeOrganizationId) {
    return ctx;
  }

  const tenantDb = db.forTenant({ organizationId: sessionRow.activeOrganizationId });
  const membershipRow = await tenantDb.membership.findFirst({
    where: { userId: userRow.id, isActive: true },
  });
  if (!membershipRow) {
    return ctx;
  }

  const rolePermissionRow = await tenantDb.rolePermission.findFirst({
    where: { role: membershipRow.role },
  });

  const permissions = resolvePermissions({
    role: membershipRow.role,
    organizationRolePermissions: rolePermissionRow?.permissions,
    membershipOverrides: membershipRow.permissions,
  });

  return {
    ...ctx,
    membership: {
      id: membershipRow.id,
      role: membershipRow.role,
      siteIds: membershipRow.siteIds,
    },
    permissions,
    allowedSiteIds: membershipRow.siteIds.length === 0 ? "ALL" : membershipRow.siteIds,
  };
}
