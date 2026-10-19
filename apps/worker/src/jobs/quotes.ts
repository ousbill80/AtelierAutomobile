// M05 RG-M05-08 / US-M05-10 — `quotes.expire` : un devis SENT/VIEWED dont `validUntil` est
// dépassée passe EXPIRED ; ses lignes non acceptées issues de l'inspection alimentent
// `VehicleRecommendation` (relance future, A8) ; les relances QUOTE_FOLLOWUP sont annulées ;
// `quote.expired` est émis (M10 l'exploite aussi) ; le conseiller est notifié une fois.
import { addDays, businessDate, isQuoteExpired } from "@atelieros/core";
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
    where: { status: { in: ["SENT", "VIEWED"] }, deletedAt: null, supersededAt: null },
  });
  let expired = 0;
  for (const quote of candidates) {
    if (!isQuoteExpired(quote.validUntil, today)) continue;
    await tenantDb.transaction(async (tx) => {
      await tx.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
      const lines = await tx.quoteLine.findMany({ where: { quoteId: quote.id } });
      if (quote.vehicleId) {
        for (const line of lines) {
          if (line.accepted === true || !line.inspectionItemId || line.type !== "LABOR") continue;
          const existing = await tx.vehicleRecommendation.findFirst({
            where: { quoteLineId: line.id },
          });
          if (existing) continue;
          await tx.vehicleRecommendation.create({
            data: {
              organizationId,
              vehicleId: quote.vehicleId,
              customerId: quote.customerId,
              repairOrderId: quote.repairOrderId,
              inspectionItemId: line.inspectionItemId,
              quoteLineId: line.id,
              label: line.groupLabel ?? line.description,
              severity: line.priority === "URGENT" ? "URGENT" : "WATCH",
              estimatedAmount: line.lineTotal,
              remindAt: addDays(today, 90),
            },
          });
        }
      }
      await tx.reminder.updateMany({
        where: {
          quoteId: quote.id,
          type: "QUOTE_FOLLOWUP",
          status: { in: ["PLANNED", "NEEDS_APPROVAL", "SNOOZED"] },
        },
        data: { status: "CANCELLED", skippedReason: "Devis expiré." },
      });
      await tx.domainEvent.create({
        data: {
          organizationId,
          type: "quote.expired",
          payload: {
            quoteId: quote.id,
            number: quote.number,
            customerId: quote.customerId,
            vehicleId: quote.vehicleId,
            repairOrderId: quote.repairOrderId,
            total: quote.total,
          } as Prisma.InputJsonValue,
        },
      });
      if (quote.createdById) {
        const dedupeKey = `quote.expired:${quote.id}`;
        const existing = await tx.notification.findFirst({
          where: { membershipId: quote.createdById, dedupeKey },
        });
        if (!existing) {
          await tx.notification.create({
            data: {
              organizationId,
              membershipId: quote.createdById,
              type: "quote.expired",
              title: `Devis ${quote.number} expiré sans réponse`,
              link: `/devis/${quote.id}`,
              severity: "info",
              dedupeKey,
            },
          });
        }
      }
    });
    expired += 1;
  }
  return expired;
}

export async function processQuotesExpireJob(now = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  for (const org of organizations) {
    try {
      const count = await expireQuotesForOrganization(org.id, now);
      if (count > 0) logger.info({ organizationId: org.id, count }, "quotes.expire : devis expirés");
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        "quotes.expire : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
