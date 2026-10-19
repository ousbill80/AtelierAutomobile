// M05 §9 — `quotes.expire` : devis SENT/VIEWED dont la validité est dépassée → EXPIRED,
// événement `quote.expired` (M10 arrête les relances), lignes non acceptées liées à des points
// d'inspection → travaux conseillés (VehicleRecommendation, relance RECOMMENDED_WORK A8),
// notification au conseiller.
import { addDays, businessDate, groupKeyOf, shouldExpire } from "@atelieros/core";
import { adminDb, db, type Prisma } from "@atelieros/db";
import { logger } from "../logger";

export async function expireQuotesForOrganization(
  organizationId: string,
  now: Date,
): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const today = businessDate(now, org.timezone);
  const tenantDb = db.forTenant({ organizationId });
  const candidates = await tenantDb.quote.findMany({
    where: {
      status: { in: ["SENT", "VIEWED"] },
      supersededAt: null,
      deletedAt: null,
      validUntil: { lt: today },
    },
  });
  let expired = 0;
  for (const quote of candidates) {
    if (!shouldExpire(quote, today)) continue;
    await tenantDb.transaction(async (tx) => {
      const moved = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: ["SENT", "VIEWED"] } },
        data: { status: "EXPIRED" },
      });
      if (moved.count === 0) return;
      expired += 1;
      await tx.domainEvent.create({
        data: {
          organizationId,
          type: "quote.expired",
          payload: { quoteId: quote.id, number: quote.number } as Prisma.InputJsonValue,
        },
      });
      if (quote.vehicleId) {
        const lines = await tx.quoteLine.findMany({
          where: { quoteId: quote.id, inspectionItemId: { not: null }, accepted: { not: true } },
        });
        const groups = new Map<string, typeof lines>();
        for (const l of lines) groups.set(groupKeyOf(l), [...(groups.get(groupKeyOf(l)) ?? []), l]);
        for (const group of groups.values()) {
          const first = group[0]!;
          const exists = await tx.vehicleRecommendation.findFirst({
            where: { quoteLineId: { in: group.map((g) => g.id) } },
          });
          if (exists) continue;
          await tx.vehicleRecommendation.create({
            data: {
              organizationId,
              vehicleId: quote.vehicleId,
              customerId: quote.customerId,
              repairOrderId: quote.repairOrderId,
              inspectionItemId: first.inspectionItemId,
              quoteLineId: first.id,
              label: first.groupLabel ?? first.description,
              severity: first.priority === "URGENT" ? "URGENT" : "WATCH",
              estimatedAmount: group.reduce((s, g) => s + g.lineTotal, 0),
              remindAt: addDays(today, 30),
            },
          });
        }
      }
      if (quote.createdById) {
        await tx.notification.create({
          data: {
            organizationId,
            membershipId: quote.createdById,
            type: "quote.expired",
            title: `Devis expiré — ${quote.number}`,
            link: `/devis/${quote.id}`,
            dedupeKey: `quote.expired:${quote.id}`,
          },
        });
      }
    });
  }
  return expired;
}

export async function processQuotesExpireJob(now: Date = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let total = 0;
  for (const org of organizations) {
    try {
      total += await expireQuotesForOrganization(org.id, now);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: (error as Error).message },
        "quotes.expire : échec",
      );
    }
  }
  logger.info({ expired: total }, "quotes.expire terminé");
}
