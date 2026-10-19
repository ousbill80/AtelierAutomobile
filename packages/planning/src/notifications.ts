import { db, type Role } from "@atelieros/db";

export interface NotifyInput {
  organizationId: string;
  roles: readonly Role[];
  /** Restreindre aux membres rattachés à ce site (ou à tous les sites). */
  siteId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Clé de dédoublonnage : une notification de ce type/clé par jour et par membre au maximum. */
  dedupeKey?: string;
}

/** Notifications internes (`Notification`) aux membres actifs des rôles visés. */
export async function notifyRoles(input: NotifyInput): Promise<number> {
  const tenantDb = db.forTenant({ organizationId: input.organizationId });
  const members = await tenantDb.membership.findMany({
    where: { isActive: true, role: { in: [...input.roles] } },
    select: { id: true, siteIds: true },
  });
  const targets = members.filter(
    (m) => !input.siteId || m.siteIds.length === 0 || m.siteIds.includes(input.siteId),
  );
  if (targets.length === 0) return 0;
  const type = input.dedupeKey ? `${input.type}:${input.dedupeKey}` : input.type;
  if (input.dedupeKey) {
    const existing = await tenantDb.notification.findFirst({ where: { type } });
    if (existing) return 0;
  }
  await tenantDb.notification.createMany({
    data: targets.map((m) => ({
      organizationId: input.organizationId,
      membershipId: m.id,
      type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });
  return targets.length;
}
