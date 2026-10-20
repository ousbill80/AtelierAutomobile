// M12 RG-M12-30 — chargement des chiffres du résumé quotidien gérant pour un destinataire,
// partagé par le job `digest.owner` (apps/worker) et `digest.preview` (apps/web). Les
// formules restent dans `@atelieros/core` (dashboard) ; ce module ne fait que lire les faits.
import {
  ALERT_NOTIFICATION_TYPES,
  buildDigestText,
  type DigestInput,
  computeRevenue,
  RO_IN_PROGRESS_STATUSES,
  computeReceivables,
  localDay,
  OPEN_INVOICE_STATUSES,
  recoveredByReminders,
  shiftDay,
  startOfLocalDay,
} from "@atelieros/core";
import type { db } from "../tenant";
import { collected, revenueAggregates } from "../reports/facts";

type TenantDb = ReturnType<typeof db.forTenant>;

/** Charge les chiffres du résumé pour un destinataire et compose le texte (RG-M12-30). */
export async function buildDigestForMembership(
  tenantDb: TenantDb,
  org: { id: string; name: string; timezone: string; operatingMode: string },
  membership: { id: string; siteIds: string[] },
  now: Date,
  link: string,
  options: {
    /**
     * M17 RG-M17-21 : phrase « faits marquants » calculée par l'appelant (service IA) à partir
     * des chiffres du résumé ; `null` ou une erreur → résumé sans phrase (jamais bloquant).
     */
    highlight?: (input: DigestInput) => Promise<string | null>;
  } = {},
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
          OR: [
            { type: { startsWith: "alert." } },
            { type: { in: Object.keys(ALERT_NOTIFICATION_TYPES) } },
          ],
          readAt: null,
          severity: { in: ["critical", "warning"] },
          createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        take: 3,
        select: { title: true },
      }),
    ]);

  const full =
    org.operatingMode === "FULL" ? await loadFullModeFacts(tenantDb, org, siteIds, now) : null;
  const receivables = computeReceivables(invoices, today);
  const attributions = attributionRows.map((r) => ({
    source: r.source,
    amount: r.amount,
    // Filtré sur `payment` ci-dessus : une attribution vient toujours d'un paiement (jamais d'un crédit).
    receivedAt: r.paymentAllocation.payment!.receivedAt,
  }));

  const digest: DigestInput = {
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
    ...(full ?? {}),
    alerts: alerts.map((a) => a.title),
    link,
  };
  let highlight: string | null = null;
  if (options.highlight) {
    try {
      highlight = await options.highlight(digest);
    } catch {
      highlight = null;
    }
  }
  return buildDigestText({ ...digest, highlight });
}

/**
 * RG-M12-30, mode FULL — CA HT et encaissements d'hier (mêmes définitions que le tableau de
 * bord : `core/reports`), OR ouverts / livrés hier et en cours, RDV et véhicules promis du jour,
 * OR bloqués en attente de pièces depuis plus de 48 h.
 */
async function loadFullModeFacts(
  tenantDb: TenantDb,
  org: { id: string; timezone: string },
  siteIds: string[],
  now: Date,
) {
  const tz = org.timezone;
  const today = localDay(now, tz);
  const todayStart = startOfLocalDay(today, tz);
  const tomorrowStart = startOfLocalDay(shiftDay(today, 1), tz);
  const yesterdayStart = startOfLocalDay(shiftDay(today, -1), tz);
  const scope = { siteIds: siteIds.length > 0 ? siteIds : null };
  const site = scope.siteIds ? { siteId: { in: scope.siteIds } } : {};
  const [revenueRows, cash, opened, delivered, inProgress, appointments, promised, blocked] =
    await Promise.all([
      revenueAggregates(tenantDb, org.id, scope, yesterdayStart, todayStart),
      collected(tenantDb, scope, yesterdayStart, todayStart),
      tenantDb.repairOrder.count({
        where: {
          ...site,
          createdAt: { gte: yesterdayStart, lt: todayStart },
          status: { not: "CANCELLED" },
          deletedAt: null,
          origin: { not: "IMPORTED" },
        },
      }),
      tenantDb.repairOrder.count({
        where: { ...site, deliveredAt: { gte: yesterdayStart, lt: todayStart }, deletedAt: null },
      }),
      tenantDb.repairOrder.count({
        where: { ...site, status: { in: [...RO_IN_PROGRESS_STATUSES] }, deletedAt: null },
      }),
      tenantDb.appointment.count({
        where: {
          ...site,
          startsAt: { gte: todayStart, lt: tomorrowStart },
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
      }),
      tenantDb.repairOrder.count({
        where: {
          ...site,
          promisedAt: { gte: todayStart, lt: tomorrowStart },
          status: { notIn: ["DELIVERED", "INVOICED", "CANCELLED"] },
          deletedAt: null,
        },
      }),
      tenantDb.repairOrder.count({
        where: {
          ...site,
          status: "WAITING_PARTS",
          waitingPartsSince: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
          deletedAt: null,
        },
      }),
    ]);
  return {
    yesterday: {
      revenueHt: computeRevenue(revenueRows).ht,
      collected: cash.total,
      byMethod: cash.byMethod,
    },
    orders: { opened, delivered, inProgress },
    today: { appointments, promised, blockedParts: blocked },
  };
}
