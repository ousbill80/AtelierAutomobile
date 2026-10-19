// M08 §9 — `cash.check_unclosed` : RG-M08-29, toute session de caisse ouverte à 23:00 (fuseau de
// l'organisation) notifie le caissier et le propriétaire, une fois par session. Le lendemain,
// l'ouverture d'une nouvelle session est bloquée par `cash.open` (core/billing/cash).
import { formatDate, systemClock, type Clock } from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

export async function checkUnclosedSessions(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const sessions = await tenantDb.cashSession.findMany({
    where: { closedAt: null, openedAt: { lte: now } },
    include: { site: { select: { name: true } } },
  });
  if (sessions.length === 0) return 0;
  const owners = await tenantDb.membership.findMany({
    where: { isActive: true, role: "OWNER" },
    select: { id: true },
  });
  let notified = 0;
  for (const session of sessions) {
    const recipients = [...new Set([session.openedById, ...owners.map((o) => o.id)])];
    const dedupeKey = `cash.unclosed:${session.id}`;
    for (const membershipId of recipients) {
      const existing = await tenantDb.notification.findFirst({
        where: { membershipId, dedupeKey },
      });
      if (existing) continue;
      await tenantDb.notification.create({
        data: {
          organizationId,
          membershipId,
          type: "cash.session_not_closed",
          title: `Caisse non clôturée — ${session.site.name}`,
          body: `Session ouverte le ${formatDate(session.openedAt, org.timezone)} : clôturez-la, sinon la prochaine ouverture sera bloquée.`,
          link: "/caisse",
          dedupeKey,
        },
      });
      notified++;
    }
    const alreadyEmitted = await tenantDb.domainEvent.count({
      where: {
        type: "cash.session_not_closed",
        payload: { path: ["sessionId"], equals: session.id },
      },
    });
    if (alreadyEmitted === 0) {
      await tenantDb.domainEvent.create({
        data: {
          organizationId,
          type: "cash.session_not_closed",
          payload: { sessionId: session.id, siteId: session.siteId },
        },
      });
    }
  }
  return notified;
}

export async function processCashCheckUnclosedJob(clock: Clock = systemClock): Promise<number> {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let total = 0;
  for (const org of organizations) {
    try {
      total += await checkUnclosedSessions(org.id, clock.now());
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "cash.check_unclosed : échec sur une organisation, passage à la suivante",
      );
    }
  }
  return total;
}
