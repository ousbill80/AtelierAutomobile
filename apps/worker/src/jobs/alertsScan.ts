// M12 §9 — `alerts.scan` (toutes les 15 min) : RG-M12-27, partie 1 (étape 2.4) —
// channel_error, sms_balance_low, import_stale, receivable_45d, promise_broken. Chaque alerte
// devient une `Notification` (type `alert.<code>`) par destinataire, dédoublonnée par
// `(organizationId, membershipId, dedupeKey)` : une fois par objet et par jour.
import {
  evaluateAlerts,
  formatFCFA,
  localDay,
  OPEN_INVOICE_STATUSES,
  shiftDay,
  startOfLocalDay,
  type AlertCandidate,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { logger } from "../logger";

const CHANNEL_LABELS: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

/** Libellés français des alertes (titre court + détail). */
export function alertTexts(alert: AlertCandidate): { title: string; body: string } {
  const p = alert.params;
  switch (alert.code) {
    case "channel_error":
      return p.channel
        ? {
            title: `Canal ${CHANNEL_LABELS[String(p.channel)] ?? p.channel} en erreur`,
            body: "Les messages ne partent plus sur ce canal. Vérifiez sa configuration.",
          }
        : {
            title: `${p.failedPct} % d'échecs d'envoi sur 24 h`,
            body: `${p.failed} messages en échec sur ${p.total}. Vérifiez vos canaux.`,
          };
    case "sms_balance_low":
      return {
        title: `Crédit SMS bas : ${p.balance} restant`,
        body: "Rechargez votre crédit SMS pour que les relances continuent de partir.",
      };
    case "import_stale":
      return {
        title: `Import « ${p.name} » sans succès depuis plus de 3 jours`,
        body: "Vérifiez la connexion à votre ancien logiciel.",
      };
    case "receivable_45d":
      return {
        title: `Facture ${p.number} en retard de ${p.days} j — ${p.customer}`,
        body: `Solde dû : ${formatFCFA(Number(p.balance))}.`,
      };
    case "promise_broken":
      return {
        title: `Promesse non tenue — ${p.customer}`,
        body: `Montant promis : ${formatFCFA(Number(p.amount))}.`,
      };
  }
}

export async function scanOrganizationAlerts(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const today = localDay(now, org.timezone);
  const overdueBefore = startOfLocalDay(shiftDay(today, -45), org.timezone);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [channels, total, failed, dataSources, invoices, promises] = await Promise.all([
    tenantDb.channelConfig.findMany({
      select: {
        id: true,
        channel: true,
        provider: true,
        isActive: true,
        status: true,
        balance: true,
      },
    }),
    tenantDb.message.count({ where: { direction: "OUTBOUND", createdAt: { gte: since24h } } }),
    tenantDb.message.count({
      where: { direction: "OUTBOUND", createdAt: { gte: since24h }, status: "FAILED" },
    }),
    tenantDb.dataSource.findMany({
      select: { id: true, name: true, isActive: true, lastRunAt: true, lastStatus: true },
    }),
    tenantDb.invoice.findMany({
      where: {
        type: "INVOICE",
        billTo: "CUSTOMER",
        status: { in: [...OPEN_INVOICE_STATUSES] },
        balance: { gt: 0 },
        dueDate: { lt: overdueBefore },
      },
      select: {
        id: true,
        number: true,
        balance: true,
        dueDate: true,
        customer: { select: { displayName: true } },
      },
    }),
    // Promesses passées à BROKEN dans les 7 derniers jours (pas de date de changement de
    // statut en base : on s'appuie sur la date promise).
    tenantDb.paymentPromise.findMany({
      where: {
        status: "BROKEN",
        promisedDate: { gte: startOfLocalDay(shiftDay(today, -7), org.timezone) },
      },
      select: {
        id: true,
        amount: true,
        collectionCase: { select: { customer: { select: { displayName: true } } } },
      },
    }),
  ]);

  const alerts = evaluateAlerts({
    today,
    now,
    channels,
    messages24h: { total, failed },
    dataSources,
    overdueInvoices: invoices.map((i) => ({ ...i, customerName: i.customer.displayName })),
    brokenPromises: promises.map((p) => ({
      id: p.id,
      amount: p.amount,
      customerName: p.collectionCase.customer.displayName,
    })),
  });
  if (alerts.length === 0) return 0;

  const memberships = await tenantDb.membership.findMany({
    where: { isActive: true },
    select: { id: true, role: true },
  });
  const data = alerts.flatMap((alert) => {
    const { title, body } = alertTexts(alert);
    return memberships
      .filter((m) => alert.roles.includes(m.role))
      .map((m) => ({
        organizationId,
        membershipId: m.id,
        type: `alert.${alert.code}`,
        title,
        body,
        link: alert.link,
        severity: alert.severity,
        dedupeKey: alert.dedupeKey,
      }));
  });
  const created = await tenantDb.notification.createMany({ data, skipDuplicates: true });
  return created.count;
}

export async function processAlertsScanJob(now = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  for (const { id: organizationId } of organizations) {
    try {
      await scanOrganizationAlerts(organizationId, now);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "alerts.scan : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
