// M12 §8 — routeurs `dashboard` et `alerts` (partie 1, étape 2.4) : onglets Synthèse
// (version AutoRappel / REMINDERS_ONLY), Relances et Finances (créances), bloc Alertes.
// Toutes les formules viennent de `@atelieros/core` (dashboard) ; ce routeur ne fait que
// charger les faits via `db.forTenant` et appliquer le filtre site (RG-M12-02).
import { TRPCError } from "@trpc/server";
import {
  computeReceivables,
  computeReminderResults,
  computeReturnRate,
  dso,
  localDay,
  OPEN_INVOICE_STATUSES,
  recoveredByReminders,
  resolvePeriod,
  shiftDay,
  sortAlerts,
  startOfLocalDay,
  topUnpaid,
  variation,
  weeklySends,
  type ReceivableInvoiceLike,
  type ReminderFactLike,
} from "@atelieros/core";
import { adminDb, buildDigestForMembership, db, type Prisma } from "@atelieros/db";
import {
  alertsListInputSchema,
  alertsMarkReadInputSchema,
  dashboardInputSchema,
  DEFAULT_DIGEST_SETTINGS,
  digestSettingsSchema,
  digestUpdateSettingsInputSchema,
} from "@atelieros/validators";
import { orgProcedure, requirePermission, router } from "../trpc";

type SiteScope = { siteIds: string[] | null };
type TenantDb = ReturnType<typeof db.forTenant>;

/**
 * RG-M12-02 : le filtre site est toujours intersecté avec `Membership.siteIds`. `siteIds =
 * null` signifie « Tous les sites » (faits non attribuables inclus).
 */
function resolveSiteScope(
  ctx: { allowedSiteIds: string[] | "ALL" },
  siteId: string | undefined,
): SiteScope {
  if (siteId) {
    if (ctx.allowedSiteIds !== "ALL" && !ctx.allowedSiteIds.includes(siteId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Vous n'avez pas accès à ce site." });
    }
    return { siteIds: [siteId] };
  }
  return { siteIds: ctx.allowedSiteIds === "ALL" ? null : ctx.allowedSiteIds };
}

function invoiceSiteWhere(scope: SiteScope): Prisma.InvoiceWhereInput {
  return scope.siteIds ? { siteId: { in: scope.siteIds } } : {};
}

/** Relance → site de la facture (RECEIVABLE) ; sinon non attribuable (« Tous les sites » seulement). */
function reminderSiteWhere(scope: SiteScope): Prisma.ReminderWhereInput {
  return scope.siteIds ? { invoice: { siteId: { in: scope.siteIds } } } : {};
}

// `Organization` n'est pas un modèle « tenant » : lecture par id de l'organisation active.
async function loadOrg(organizationId: string) {
  return adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, timezone: true, operatingMode: true },
  });
}

async function loadReceivableInvoices(
  tenantDb: TenantDb,
  scope: SiteScope,
): Promise<ReceivableInvoiceLike[]> {
  const rows = await tenantDb.invoice.findMany({
    where: {
      ...invoiceSiteWhere(scope),
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
      number: true,
      customerId: true,
      customer: { select: { displayName: true } },
    },
  });
  return rows.map((r) => ({ ...r, customerName: r.customer.displayName }));
}

/**
 * RG-M12-22 (A10) : attributions M09 (`PaymentAttribution`) des paiements confirmés reçus dans
 * `[from, to)`. Chaque allocation compte sur le site de sa facture (M12 §11).
 */
async function loadAttributions(tenantDb: TenantDb, scope: SiteScope, from: Date, to: Date) {
  const rows = await tenantDb.paymentAttribution.findMany({
    where: {
      source: "reminder",
      paymentAllocation: {
        payment: { status: "CONFIRMED", receivedAt: { gte: from, lt: to } },
        ...(scope.siteIds ? { invoice: { siteId: { in: scope.siteIds } } } : {}),
      },
    },
    select: {
      source: true,
      amount: true,
      paymentAllocation: { select: { payment: { select: { receivedAt: true } } } },
    },
  });
  return rows.map((r) => ({
    source: r.source,
    amount: r.amount,
    // Filtré sur `payment` ci-dessus : une attribution vient toujours d'un paiement (jamais d'un crédit).
    receivedAt: r.paymentAllocation.payment!.receivedAt,
  }));
}

async function loadReminderFacts(
  tenantDb: TenantDb,
  scope: SiteScope,
  from: Date,
  to: Date,
): Promise<ReminderFactLike[]> {
  const rows = await tenantDb.reminder.findMany({
    where: {
      ...reminderSiteWhere(scope),
      OR: [
        { sentAt: { gte: from, lt: to } },
        { outcomeAt: { gte: from, lt: to } },
        { dueDate: { gte: from, lt: to } },
        { status: "FAILED", updatedAt: { gte: from, lt: to } },
      ],
    },
    select: {
      type: true,
      status: true,
      sentAt: true,
      outcome: true,
      outcomeAt: true,
      updatedAt: true,
      attributedAmount: true,
      attributedRevenue: true,
      customerId: true,
      vehicleId: true,
      dueDate: true,
      message: { select: { status: true } },
    },
  });
  return rows.map((r) => ({
    type: r.type,
    status: r.status,
    // Une relance FAILED n'a pas de `sentAt` : on la date à sa dernière mise à jour.
    sentAt: r.sentAt ?? (r.status === "FAILED" ? r.updatedAt : null),
    messageStatus: r.message?.status ?? null,
    outcome: r.outcome,
    outcomeAt: r.outcomeAt,
    attributedAmount: r.attributedAmount,
    attributedRevenue: r.attributedRevenue,
    customerId: r.customerId,
    vehicleId: r.vehicleId,
    dueDate: r.dueDate,
  }));
}

export const dashboardRouter = router({
  /** Onglet Synthèse — version AutoRappel (US-M12-10), cartes Créances et Récupéré. */
  overview: requirePermission("dashboard:owner")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrg(ctx.organizationId);
      const now = new Date();
      const period = resolvePeriod(input.period, now, org.timezone);
      const today = localDay(now, org.timezone);
      const todayStart = startOfLocalDay(today, org.timezone);
      const tomorrowStart = startOfLocalDay(shiftDay(today, 1), org.timezone);
      const monthEnd = new Date(
        Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 1),
      );

      const [
        invoices,
        invoiceCount,
        facts,
        attributions,
        toHandleToday,
        inspectionsDue30,
        servicesDueThisMonth,
      ] = await Promise.all([
        loadReceivableInvoices(tenantDb, scope),
        tenantDb.invoice.count({ where: invoiceSiteWhere(scope) }),
        loadReminderFacts(tenantDb, scope, period.previousFrom, period.to),
        loadAttributions(tenantDb, scope, period.previousFrom, period.to),
        tenantDb.reminder.count({
          where: {
            ...reminderSiteWhere(scope),
            OR: [
              { status: "NEEDS_APPROVAL" },
              { status: "PLANNED", scheduledFor: { gte: todayStart, lt: tomorrowStart } },
            ],
          },
        }),
        // VT / révisions : véhicules non rattachés à un site → non attribuables (« Tous » seulement).
        scope.siteIds
          ? Promise.resolve(null)
          : tenantDb.vehicle.count({
              where: {
                deletedAt: null,
                inspectionExpiryDate: {
                  gte: todayStart,
                  lt: startOfLocalDay(shiftDay(today, 30), org.timezone),
                },
              },
            }),
        scope.siteIds
          ? Promise.resolve(null)
          : tenantDb.vehicle.count({
              where: { deletedAt: null, nextServiceDueDate: { gte: todayStart, lt: monthEnd } },
            }),
      ]);

      const receivables = computeReceivables(invoices, today);
      const current = computeReminderResults(facts, period.from, period.to);
      const previous = computeReminderResults(facts, period.previousFrom, period.previousTo);
      const recovered = recoveredByReminders(attributions, period.from, period.to);
      const previousRecovered = recoveredByReminders(
        attributions,
        period.previousFrom,
        period.previousTo,
      );

      return {
        period: { preset: period.preset, fromDate: period.fromDate, toDate: period.toDate },
        mode: org.operatingMode,
        hasInvoices: invoiceCount > 0,
        receivables: {
          total: receivables.total,
          over30: receivables.over30,
          overdue: receivables.overdue,
        },
        recovered: {
          value: recovered,
          variation: variation(recovered, previousRecovered),
        },
        remindersToHandleToday: toHandleToday,
        inspectionsDue30,
        servicesDueThisMonth,
        reminders: {
          sent: current.sent,
          sentVariation: variation(current.sent, previous.sent),
          returnedCustomers: current.returnedCustomers,
        },
        topUnpaid: topUnpaid(invoices, today, 5),
        computedAt: now,
      };
    }),

  /** Onglet Relances (M12 §7). */
  reminders: requirePermission("reminder:read")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrg(ctx.organizationId);
      const now = new Date();
      const period = resolvePeriod(input.period, now, org.timezone);
      const [facts, attributions, toApprove] = await Promise.all([
        loadReminderFacts(tenantDb, scope, period.previousFrom, period.to),
        loadAttributions(tenantDb, scope, period.previousFrom, period.to),
        tenantDb.reminder.count({
          where: { ...reminderSiteWhere(scope), status: "NEEDS_APPROVAL" },
        }),
      ]);
      const current = computeReminderResults(facts, period.from, period.to);
      const previous = computeReminderResults(facts, period.previousFrom, period.previousTo);
      const recovered = recoveredByReminders(attributions, period.from, period.to);
      const previousRecovered = recoveredByReminders(
        attributions,
        period.previousFrom,
        period.previousTo,
      );
      return {
        period: { preset: period.preset, fromDate: period.fromDate, toDate: period.toDate },
        sent: current.sent,
        delivered: current.delivered,
        read: current.read,
        failed: current.failed,
        toApprove,
        sentByType: current.sentByType,
        sentVariation: variation(current.sent, previous.sent),
        returnedCustomers: current.returnedCustomers,
        recoveredAmount: recovered,
        recoveredVariation: variation(recovered, previousRecovered),
        generatedRevenue: current.generatedRevenue,
        returnRate: {
          inspection: computeReturnRate(facts, "INSPECTION", period.from, period.to, now),
          service: computeReturnRate(facts, "SERVICE", period.from, period.to, now),
        },
        weekly: weeklySends(facts, period.from, period.to),
        computedAt: now,
      };
    }),

  /** Onglet Finances — créances (RG-M12-17/18/19) à l'instant présent. */
  finances: requirePermission("report:financial")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrg(ctx.organizationId);
      const now = new Date();
      const today = localDay(now, org.timezone);
      const since90 = startOfLocalDay(shiftDay(today, -90), org.timezone);
      const validStatuses = [
        "ISSUED",
        "PARTIALLY_PAID",
        "PAID",
        "OVERDUE",
        "DISPUTED",
        "WRITTEN_OFF",
      ] as const;

      const [invoices, invoiceCount, revenue90] = await Promise.all([
        loadReceivableInvoices(tenantDb, scope),
        tenantDb.invoice.count({ where: invoiceSiteWhere(scope) }),
        tenantDb.invoice.groupBy({
          by: ["type"],
          where: {
            ...invoiceSiteWhere(scope),
            type: { in: ["INVOICE", "CREDIT_NOTE"] },
            status: { in: [...validStatuses] },
            issuedAt: { gte: since90, lte: now },
          },
          _sum: { total: true },
        }),
      ]);
      // RG-M12-03 : avoirs soustraits du CA TTC.
      const revenueTtc90d = revenue90.reduce(
        // M08 : un avoir porte des montants négatifs (RG-M08-12) ; abs() garde les deux conventions.
        (sum, g) =>
          sum + (g.type === "CREDIT_NOTE" ? -Math.abs(g._sum.total ?? 0) : (g._sum.total ?? 0)),
        0,
      );
      const receivables = computeReceivables(invoices, today);
      return {
        hasInvoices: invoiceCount > 0,
        receivables,
        dso: dso(receivables.total, revenueTtc90d),
        topUnpaid: topUnpaid(invoices, today, 10),
        computedAt: now,
      };
    }),
});

// Les alertes sont des notifications personnelles (filtrées par `membershipId`) : aucune
// permission de module requise, l'appartenance à l'organisation suffit (orgProcedure).
export const alertsRouter = router({
  list: orgProcedure.input(alertsListInputSchema).query(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.notification.findMany({
      where: {
        membershipId: ctx.membership.id,
        type: { startsWith: "alert." },
        ...(input.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return input.unreadOnly ? sortAlerts(rows, input.limit) : rows.slice(0, input.limit);
  }),

  markRead: orgProcedure.input(alertsMarkReadInputSchema).mutation(async ({ ctx, input }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const result = await tenantDb.notification.updateMany({
      where: { id: { in: input.ids }, membershipId: ctx.membership.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }),
});

// M12 §8 — résumé quotidien gérant (RG-M12-30) : aperçu du message tel qu'il serait envoyé
// aujourd'hui au membre connecté, et réglages `Organization.settings.digest`.
export const digestRouter = router({
  preview: requirePermission("dashboard:owner").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const org = await loadOrg(ctx.organizationId);
    const text = await buildDigestForMembership(
      tenantDb,
      org,
      { id: ctx.membership.id, siteIds: ctx.membership.siteIds },
      new Date(),
      `${process.env.APP_URL ?? "http://localhost:3000"}/tableau-de-bord`,
    );
    return { text };
  }),

  getSettings: requirePermission("settings:read").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
    const raw = (org.settings as { digest?: unknown } | null)?.digest ?? {};
    return digestSettingsSchema.catch(DEFAULT_DIGEST_SETTINGS).parse(raw);
  }),

  updateSettings: requirePermission("settings:update")
    .input(digestUpdateSettingsInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.recipients.length > 0) {
        const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
        const found = await tenantDb.membership.count({
          where: { id: { in: input.recipients }, isActive: true },
        });
        if (found !== new Set(input.recipients).size) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Un destinataire du résumé n'est pas un membre actif de ce garage.",
          });
        }
      }
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
      });
      const settings = (org.settings as Record<string, unknown> | null) ?? {};
      await adminDb.organization.update({
        where: { id: ctx.organizationId },
        data: { settings: { ...settings, digest: input } },
      });
      return input;
    }),
});
