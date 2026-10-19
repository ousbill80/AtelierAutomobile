// M12 §9 — `digest.owner` (toutes les 15 min) : résumé quotidien gérant (US-M12-08,
// RG-M12-30). Pour chaque organisation dont l'heure locale a atteint `settings.digest.time`,
// envoie à chaque destinataire (OWNER actifs par défaut) un message M11 `kind = DIGEST`,
// une seule fois par jour (`idempotencyKey = digest:{membershipId}:{date}`). Message interne :
// pas soumis à `OptOut`. Chiffres filtrés par `Membership.siteIds`.
import {
  buildDigestText,
  computeReceivables,
  computeReminderResults,
  digestDedupeKey,
  isDigestDue,
  localDay,
  RECEIVABLE_STATUSES,
  shiftDay,
  startOfLocalDay,
  type Channel,
} from "@atelieros/core";
import { adminDb, db } from "@atelieros/db";
import { DEFAULT_DIGEST_SETTINGS, digestSettingsSchema } from "@atelieros/validators";
import { logger } from "../logger";
import { enqueueMessageSendJob } from "../queues/messages";

type TenantDb = ReturnType<typeof db.forTenant>;

interface Recipient {
  membershipId: string;
  siteIds: string[];
  phone: string | null;
  email: string | null;
}

/** Charge les chiffres du résumé pour un destinataire et compose le texte (RG-M12-30). */
export async function buildDigestForMembership(
  tenantDb: TenantDb,
  org: { name: string; timezone: string; operatingMode: string },
  membership: { id: string; siteIds: string[] },
  now: Date,
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

  const [invoices, toApprove, failed, facts, promises, inspections, services, alerts] =
    await Promise.all([
      tenantDb.invoice.findMany({
        where: {
          ...invoiceSite,
          type: "INVOICE",
          status: { in: [...RECEIVABLE_STATUSES] },
          balance: { gt: 0 },
        },
        select: {
          id: true,
          type: true,
          status: true,
          balance: true,
          dueDate: true,
          customerId: true,
        },
      }),
      tenantDb.reminder.count({ where: { ...reminderSite, status: "NEEDS_APPROVAL" } }),
      tenantDb.reminder.count({
        where: { ...reminderSite, status: "FAILED", updatedAt: { gte: yesterdayStart } },
      }),
      tenantDb.reminder.findMany({
        where: { ...reminderSite, type: "RECEIVABLE", outcomeAt: { gte: since30, lt: todayStart } },
        select: {
          type: true,
          status: true,
          sentAt: true,
          outcome: true,
          outcomeAt: true,
          attributedAmount: true,
          attributedRevenue: true,
          customerId: true,
          vehicleId: true,
          dueDate: true,
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
  const reminderFacts = facts.map((f) => ({ ...f, messageStatus: null }));
  const yesterday = computeReminderResults(reminderFacts, yesterdayStart, todayStart);
  const last30 = computeReminderResults(reminderFacts, since30, todayStart);

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
    recovered: { yesterday: yesterday.recoveredAmount, last30Days: last30.recoveredAmount },
    remindersOnly: { inspectionsDue30: inspections, servicesDueThisMonth: services },
    alerts: alerts.map((a) => a.title),
    link: `${process.env.APP_URL ?? "http://localhost:3000"}/tableau-de-bord`,
  });
}

function addressFor(channel: Channel, recipient: Recipient): string | null {
  return channel === "EMAIL" ? recipient.email : recipient.phone;
}

export async function sendOrganizationDigest(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true, operatingMode: true, settings: true },
  });
  const raw = (org.settings as { digest?: unknown } | null)?.digest ?? {};
  const settings = digestSettingsSchema.catch(DEFAULT_DIGEST_SETTINGS).parse(raw);
  if (!settings.enabled || !isDigestDue(now, org.timezone, settings.time)) return 0;

  const tenantDb = db.forTenant({ organizationId });
  const today = localDay(now, org.timezone);
  const memberships = await tenantDb.membership.findMany({
    where: {
      isActive: true,
      ...(settings.recipients.length > 0 ? { id: { in: settings.recipients } } : { role: "OWNER" }),
    },
    select: { id: true, siteIds: true, user: { select: { phone: true, email: true } } },
  });
  const configs = await tenantDb.channelConfig.findMany({
    where: { isActive: true },
    orderBy: { priority: "asc" },
    select: { channel: true, provider: true },
  });
  const providerByChannel = new Map<string, string>();
  for (const c of configs)
    if (!providerByChannel.has(c.channel)) providerByChannel.set(c.channel, c.provider);

  let sent = 0;
  for (const m of memberships) {
    const recipient: Recipient = {
      membershipId: m.id,
      siteIds: m.siteIds,
      phone: m.user.phone,
      email: m.user.email,
    };
    // Canal configuré, sinon repli email (RG-M12-30 : « si WhatsApp échoue → email »).
    const channel = ([settings.channel, "EMAIL"] as Channel[]).find(
      (c) => providerByChannel.has(c) && addressFor(c, recipient),
    );
    if (!channel) {
      logger.warn(
        { organizationId, membershipId: m.id },
        "digest.owner : aucun canal ni adresse, ignoré",
      );
      continue;
    }
    const idempotencyKey = digestDedupeKey(m.id, today);
    const existing = await tenantDb.message.findFirst({ where: { idempotencyKey } });
    if (existing) continue;

    const body = await buildDigestForMembership(tenantDb, org, m, now);
    try {
      const message = await tenantDb.message.create({
        data: {
          organizationId,
          direction: "OUTBOUND",
          channel,
          to: addressFor(channel, recipient)!,
          subject: channel === "EMAIL" ? `Résumé du jour — ${org.name}` : undefined,
          body,
          status: "QUEUED",
          provider: providerByChannel.get(channel)!,
          kind: "DIGEST",
          idempotencyKey,
        },
      });
      await enqueueMessageSendJob(message.id);
      sent += 1;
    } catch (error) {
      // Contrainte unique (organizationId, idempotencyKey, channel) : passage concurrent.
      const isUniqueViolation =
        typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!isUniqueViolation) throw error;
    }
  }
  return sent;
}

export async function processDigestOwnerJob(now = new Date()): Promise<void> {
  const organizations = await adminDb.organization.findMany({ select: { id: true } });
  for (const { id: organizationId } of organizations) {
    try {
      await sendOrganizationDigest(organizationId, now);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "digest.owner : échec sur une organisation, passage à la suivante",
      );
    }
  }
}
