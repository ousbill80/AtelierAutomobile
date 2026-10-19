// M12 RG-M12-30 — chargement des chiffres du résumé quotidien gérant pour un destinataire,
// partagé par le job `digest.owner` (apps/worker) et `digest.preview` (apps/web). Les
// formules restent dans `@atelieros/core` (dashboard) ; ce module ne fait que lire les faits.
import {
  buildDigestText,
  computeReceivables,
  localDay,
  OPEN_INVOICE_STATUSES,
  recoveredByReminders,
  shiftDay,
  startOfLocalDay,
} from "@atelieros/core";
import type { db } from "../tenant";

type TenantDb = ReturnType<typeof db.forTenant>;

/** Charge les chiffres du résumé pour un destinataire et compose le texte (RG-M12-30). */
export async function buildDigestForMembership(
  tenantDb: TenantDb,
  org: { name: string; timezone: string; operatingMode: string },
  membership: { id: string; siteIds: string[] },
  now: Date,
  link: string,
): Promise<string> {
  const { siteIds } = membership;
  const tz = org.timezone;
  const today = localDay(now, tz);
  const todayStart = startOfLocalDay(today, tz);
  const yesterdayStart = startOfLocalDay(shiftDay(today, -1), tz);
  const since30 = startOfLocalDay(shiftDay(today, -30), tz);
  const restricted = siteIds.length > 0;
  const invoiceSite = restricted ? { siteId: { in: siteIds } } : {};
  const reminderSite = restricted ? { invoice: { siteId: { in: siteIds } } } : {};

  const [invoices, toApprove, failed, attributionRows, promises, inspections, services, alerts] =
    await Promise.all([
      tenantDb.invoice.findMany({
        where: {
          ...invoiceSite,
          type: "INVOICE",
          billTo: "CUSTOMER",
          status: { in: [...OPEN_INVOICE_STATUSES] },
          balance: { gt: 0 },
        },
        select: {
          id: true,
          type: true,
          status: true,
          billTo: true,
          balance: true,
          dueDate: true,
          customerId: true,
        },
      }),
      tenantDb.reminder.count({ where: { ...reminderSite, status: "NEEDS_APPROVAL" } }),
      tenantDb.reminder.count({
        where: { ...reminderSite, status: "FAILED", updatedAt: { gte: yesterdayStart } },
      }),
      // RG-M12-22 (A10) : attributions M09 des paiements reçus sur 30 j, site de la facture.
      tenantDb.paymentAttribution.findMany({
        where: {
          source: "reminder",
          paymentAllocation: {
            payment: { status: "CONFIRMED", receivedAt: { gte: since30, lt: todayStart } },
            ...(restricted ? { invoice: { siteId: { in: siteIds } } } : {}),
          },
        },
        select: {
          source: true,
          amount: true,
          paymentAllocation: { select: { payment: { select: { receivedAt: true } } } },
        },
      }),
      // Promesses (M09) : non rattachées à un site → « Tous les sites » seulement.
      restricted
        ? Promise.resolve([])
        : tenantDb.paymentPromise.findMany({
            where: {
              status: "PENDING",
              promisedDate: { gte: todayStart, lt: startOfLocalDay(shiftDay(today, 1), tz) },
            },
            select: { amount: true },
          }),
      org.operatingMode === "REMINDERS_ONLY" && !restricted
        ? tenantDb.vehicle.count({
            where: {
              deletedAt: null,
              inspectionExpiryDate: {
                gte: todayStart,
                lt: startOfLocalDay(shiftDay(today, 30), tz),
              },
            },
          })
        : Promise.resolve(0),
      org.operatingMode === "REMINDERS_ONLY" && !restricted
        ? tenantDb.vehicle.count({
            where: {
              deletedAt: null,
              nextServiceDueDate: {
                gte: todayStart,
                lt: new Date(
                  Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 1),
                ),
              },
            },
          })
        : Promise.resolve(0),
      // Alertes non lues des dernières 24 h (critiques d'abord), 3 au plus.
      tenantDb.notification.findMany({
        where: {
          membershipId: membership.id,
          type: { startsWith: "alert." },
          readAt: null,
          severity: { in: ["critical", "warning"] },
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        take: 3,
        select: { title: true },
      }),
    ]);

  const receivables = computeReceivables(invoices, today);
  const attributions = attributionRows.map((r) => ({
    source: r.source,
    amount: r.amount,
    receivedAt: r.paymentAllocation.payment.receivedAt,
  }));

  return buildDigestText({
    garageName: org.name,
    now,
    timeZone: tz,
    mode: org.operatingMode === "REMINDERS_ONLY" ? "REMINDERS_ONLY" : "FULL",
    receivables: receivables.total > 0 ? receivables : null,
    promisesToday: {
      count: promises.length,
      amount: promises.reduce((sum, p) => sum + p.amount, 0),
    },
    reminders: { toApprove, failed },
    recovered: {
      yesterday: recoveredByReminders(attributions, yesterdayStart, todayStart),
      last30Days: recoveredByReminders(attributions, since30, todayStart),
    },
    remindersOnly: { inspectionsDue30: inspections, servicesDueThisMonth: services },
    alerts: alerts.map((a) => a.title),
    link,
  });
}
