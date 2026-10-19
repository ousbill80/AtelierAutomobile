import { adminDb } from "@atelieros/db";

export interface WriteAuditLogInput {
  organizationId: string;
  userId?: string | null;
  membershipId?: string | null;
  siteId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** RG-M01-15 — écriture dans AuditLog (ajout seul). Les secrets ne doivent jamais figurer dans before/after. */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  await adminDb.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      membershipId: input.membershipId ?? null,
      siteId: input.siteId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : (input.before as object),
      after: input.after === undefined ? undefined : (input.after as object),
      reason: input.reason ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
