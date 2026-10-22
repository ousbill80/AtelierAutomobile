// M12 §8 — routeurs `dashboard` et `alerts` (partie 1, étape 2.4) : onglets Synthèse
// (version AutoRappel / REMINDERS_ONLY), Relances et Finances (créances), bloc Alertes.
// Toutes les formules viennent de `@atelieros/core` (dashboard) ; ce routeur ne fait que
// charger les faits via `db.forTenant` et appliquer le filtre site (RG-M12-02).
import {
  canReadKpi,
  collectedByMethod,
  ALERT_NOTIFICATION_TYPES,
  asOfDate,
  computeReceivables,
  countInspectionBands,
  countWorkshopStages,
  daysUntil,
  groupUpcomingReminders,
  inspectionBand,
  inspectionFollowUp,
  INSPECTION_HORIZON_DAYS,
  lastDays,
  summarizeClaimStages,
  summarizeUnpaid,
  weekStartDay,
  workshopStage,
  computeReminderResults,
  computeReturnRate,
  customerCounts,
  dso,
  localDay,
  occupancy,
  quoteAcceptance,
  rankTopParts,
  recoveredByReminders,
  RO_IN_PROGRESS_STATUSES,
  shiftDay,
  sortAlerts,
  startOfLocalDay,
  topUnpaid,
  variation,
  weeklySends,
  type ReminderFactLike,
} from "@atelieros/core";
import { adminDb, buildDigestForMembership, db, reportFacts, type Prisma } from "@atelieros/db";
import {
  alertsListInputSchema,
  alertsMarkReadInputSchema,
  dashboardInputSchema,
  dashboardKpiInputSchema,
  DEFAULT_DIGEST_SETTINGS,
  digestSettingsSchema,
  digestUpdateSettingsInputSchema,
  type DashboardInput,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import {
  loadOrgReportContext,
  reportsNow,
  resolvePeriodInput,
  resolveSiteScope,
  type SiteScope,
} from "../reports/context";
import { loadProductivity } from "../workshop/productivity";
import { orgProcedure, requirePermission, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;
const {
  collected,
  computeKpi,
  loadAttributions,
  loadReceivableInvoices,
  customerActivities,
  dailyRevenue,
  partAggregates,
  quoteDecisions,
  salesMetrics,
  sitesWithCapacity,
  workloadBySite,
} = reportFacts;

/** M12 §10 : le tableau de bord n'est pas ouvert aux mécaniciens (redirigés vers la tablette). */
function assertNotMechanic(ctx: { membership: { role: string } }) {
  if (ctx.membership.role === "MECHANIC") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Le tableau de bord n'est pas accessible aux mécaniciens.",
    });
  }
}

/** Période du tableau de bord : préréglage ou personnalisée (US-M12-02). */
function periodOf(input: DashboardInput, now: Date, timeZone: string) {
  return resolvePeriodInput(input.custom ?? input.period, now, timeZone);
}

function invoiceSiteWhere(scope: SiteScope): Prisma.InvoiceWhereInput {
  return siteFilter(scope);
}

/** Filtre `siteId` des faits rattachés à un site (OR, RDV, devis, factures). */
function siteFilter(scope: SiteScope): { siteId?: { in: string[] } } {
  return scope.siteIds ? { siteId: { in: scope.siteIds } } : {};
}

/** Relance → site de la facture (RECEIVABLE) ; sinon non attribuable (« Tous les sites » seulement). */
function reminderSiteWhere(scope: SiteScope): Prisma.ReminderWhereInput {
  return scope.siteIds ? { invoice: { siteId: { in: scope.siteIds } } } : {};
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

// ---------------------------------------------------------------------------
// Onglet « Aujourd'hui » — chargeurs par bloc (formules dans `core/dashboard/today`)
// ---------------------------------------------------------------------------

const TODAY_LIST_LIMIT = 8;

async function loadTodayWorkshop(tenantDb: TenantDb, scope: SiteScope) {
  const where: Prisma.RepairOrderWhereInput = {
    ...siteFilter(scope),
    status: { in: [...RO_IN_PROGRESS_STATUSES] },
    deletedAt: null,
  };
  const [statuses, rows] = await Promise.all([
    tenantDb.repairOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
    tenantDb.repairOrder.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        promisedAt: true,
        customer: { select: { displayName: true } },
        vehicle: { select: { plate: true, make: true, model: true } },
        insuranceClaim: { select: { insuranceCompany: { select: { name: true } } } },
      },
      orderBy: [{ promisedAt: { sort: "asc", nulls: "last" } }, { number: "asc" }],
      take: TODAY_LIST_LIMIT,
    }),
  ]);
  const stages = countWorkshopStages(
    statuses.flatMap((s) => Array<string>(s._count._all).fill(s.status)),
  );
  return {
    total: statuses.reduce((sum, s) => sum + s._count._all, 0),
    stages,
    items: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      stage: workshopStage(r.status),
      promisedAt: r.promisedAt,
      plate: r.vehicle.plate,
      vehicle: `${r.vehicle.make} ${r.vehicle.model}`.trim(),
      customerName: r.customer.displayName,
      insurerName: r.insuranceClaim?.insuranceCompany.name ?? null,
    })),
  };
}

async function loadTodayCash(tenantDb: TenantDb, scope: SiteScope, today: string, tz: string) {
  const days = lastDays(today, 7);
  const bounds = days.map((day) => ({
    day,
    from: startOfLocalDay(day, tz),
    to: startOfLocalDay(shiftDay(day, 1), tz),
  }));
  const todayBounds = bounds[bounds.length - 1]!;
  const [series, paymentsCount, session] = await Promise.all([
    Promise.all(bounds.map((b) => collected(tenantDb, scope, b.from, b.to))),
    tenantDb.payment.count({
      where: {
        ...siteFilter(scope),
        status: "CONFIRMED",
        voidedAt: null,
        receivedAt: { gte: todayBounds.from, lt: todayBounds.to },
        NOT: { origin: "IMPORTED" },
      },
    }),
    tenantDb.cashSession.findFirst({
      where: { ...siteFilter(scope), closedAt: null },
      select: { openedAt: true },
      orderBy: { openedAt: "asc" },
    }),
  ]);
  const todaySummary = series[series.length - 1]!;
  return {
    total: todaySummary.total,
    byMethod: todaySummary.byMethod,
    paymentsCount,
    sessionOpenedAt: session?.openedAt ?? null,
    daily: bounds.map((b, i) => ({ day: b.day, total: series[i]!.total })),
  };
}

async function loadTodayInspections(tenantDb: TenantDb, today: string) {
  const from = asOfDate(today);
  const to = asOfDate(shiftDay(today, INSPECTION_HORIZON_DAYS + 1));
  const vehicles = await tenantDb.vehicle.findMany({
    where: { deletedAt: null, inspectionExpiryDate: { gte: from, lt: to } },
    select: {
      id: true,
      plate: true,
      make: true,
      model: true,
      inspectionExpiryDate: true,
      customer: { select: { displayName: true } },
    },
    orderBy: { inspectionExpiryDate: "asc" },
  });
  const bands = countInspectionBands(
    vehicles.map((v) => daysUntil(v.inspectionExpiryDate!, today)),
  );
  const shown = vehicles.slice(0, TODAY_LIST_LIMIT);
  const reminders = shown.length
    ? await tenantDb.reminder.findMany({
        where: {
          type: "INSPECTION",
          vehicleId: { in: shown.map((v) => v.id) },
          status: { notIn: ["CANCELLED", "SKIPPED"] },
        },
        select: {
          vehicleId: true,
          dueDate: true,
          status: true,
          channel: true,
          outcome: true,
          message: { select: { status: true } },
        },
      })
    : [];
  return {
    total: vehicles.length,
    bands,
    items: shown.map((v) => {
      const due = v.inspectionExpiryDate!;
      const daysLeft = daysUntil(due, today);
      return {
        vehicleId: v.id,
        plate: v.plate,
        vehicle: `${v.make} ${v.model}`.trim(),
        customerName: v.customer.displayName,
        dueDate: due,
        daysLeft,
        band: inspectionBand(daysLeft),
        followUp: inspectionFollowUp(
          reminders
            .filter((r) => r.vehicleId === v.id && r.dueDate.getTime() === due.getTime())
            .map((r) => ({
              status: r.status,
              channel: r.channel,
              outcome: r.outcome,
              messageStatus: r.message?.status ?? null,
            })),
        ),
      };
    }),
  };
}

async function loadTodayReminders(
  tenantDb: TenantDb,
  scope: SiteScope,
  now: Date,
  today: string,
  tz: string,
) {
  const weekStart = startOfLocalDay(weekStartDay(today), tz);
  const horizon = startOfLocalDay(shiftDay(today, 7), tz);
  const [sentThisWeek, toApprove, upcoming] = await Promise.all([
    tenantDb.reminder.count({
      where: { ...reminderSiteWhere(scope), status: "SENT", sentAt: { gte: weekStart } },
    }),
    tenantDb.reminder.count({ where: { ...reminderSiteWhere(scope), status: "NEEDS_APPROVAL" } }),
    tenantDb.reminder.findMany({
      where: {
        ...reminderSiteWhere(scope),
        status: { in: ["PLANNED", "QUEUED"] },
        scheduledFor: { gte: now, lt: horizon },
      },
      select: { type: true, scheduledFor: true },
    }),
  ]);
  return {
    sentThisWeek,
    toApprove,
    upcoming: groupUpcomingReminders(
      upcoming.map((r) => ({ type: r.type, day: localDay(r.scheduledFor, tz) })),
    ),
  };
}

async function loadTodayClaims(tenantDb: TenantDb, scope: SiteScope, today: string) {
  const claims = await tenantDb.insuranceClaim.findMany({
    where: {
      ...siteFilter(scope),
      deletedAt: null,
      status: { notIn: ["PAID", "REJECTED", "CANCELLED"] },
    },
    select: {
      status: true,
      quoteId: true,
      approvedAmount: true,
      invoices: {
        where: { type: "INVOICE", billTo: "INSURANCE", status: { notIn: ["DRAFT", "VOID"] } },
        select: { balance: true, dueDate: true },
      },
    },
  });
  const quoteIds = claims.flatMap((c) => (c.quoteId ? [c.quoteId] : []));
  const quotes = quoteIds.length
    ? await tenantDb.quote.findMany({
        where: { id: { in: quoteIds } },
        select: { id: true, total: true },
      })
    : [];
  const quoteTotal = new Map(quotes.map((q) => [q.id, q.total]));
  return summarizeClaimStages(
    claims.map((c) => ({
      status: c.status,
      estimateAmount: c.quoteId ? (quoteTotal.get(c.quoteId) ?? null) : null,
      approvedAmount: c.approvedAmount,
      insurerBalance: c.invoices[0]?.balance ?? null,
      insurerDueDate: c.invoices[0]?.dueDate ?? null,
    })),
    today,
  );
}

export const dashboardRouter = router({
  /**
   * M12 §8 `dashboard.kpi` — un indicateur, même définition que les onglets (M12 §1), pour
   * l'assistant M17. Permission propre à chaque indicateur (`core/reports/kpi`) ; marges
   * réservées à `report:financial` ; filtre site toujours intersecté (RG-M12-02).
   */
  kpi: orgProcedure.input(dashboardKpiInputSchema).query(async ({ ctx, input }) => {
    assertNotMechanic(ctx);
    if (!canReadKpi(input.metric, ctx.permissions)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Vous n'avez pas accès à cet indicateur.",
      });
    }
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const scope = resolveSiteScope(ctx, input.siteId);
    const org = await loadOrgReportContext(ctx.organizationId);
    const now = reportsNow();
    return computeKpi(tenantDb, {
      organizationId: ctx.organizationId,
      org,
      metric: input.metric,
      scope,
      period: periodOf(input, now, org.timezone),
      now,
      compare: input.compare,
    });
  }),

  /**
   * Onglet Synthèse — 4 cartes (CA HT, Encaissé, Créances dont > 30 j, Récupéré), CA par jour,
   * CA par nature, marge, panier moyen, acceptation des devis (US-M12-01) ; en mode
   * REMINDERS_ONLY, version AutoRappel (US-M12-10). Marges omises sans `report:financial` (§10).
   */
  overview: requirePermission("dashboard:owner")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
      const period = periodOf(input, now, org.timezone);
      const today = localDay(now, org.timezone);
      const todayStart = startOfLocalDay(today, org.timezone);
      const tomorrowStart = startOfLocalDay(shiftDay(today, 1), org.timezone);
      const monthEnd = new Date(
        Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 1),
      );
      const full = org.operatingMode === "FULL";

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

      // Mode FULL : indicateurs de ventes (RG-M12-05 à 13, 20).
      const sales = full
        ? await (async () => {
            const [cur, prev, cash, prevCash, quotes, daily] = await Promise.all([
              salesMetrics(tenantDb, ctx.organizationId, org, scope, period.from, period.to),
              salesMetrics(
                tenantDb,
                ctx.organizationId,
                org,
                scope,
                period.previousFrom,
                period.previousTo,
              ),
              collected(tenantDb, scope, period.from, period.to),
              collected(tenantDb, scope, period.previousFrom, period.previousTo),
              quoteDecisions(tenantDb, scope, period),
              dailyRevenue(tenantDb, ctx.organizationId, scope, period, org.timezone),
            ]);
            const financial = ctx.permissions.has("report:financial");
            return {
              revenueHt: {
                value: cur.revenue.ht,
                variation: variation(cur.revenue.ht, prev.revenue.ht),
              },
              collected: {
                value: cash.total,
                variation: variation(cash.total, prevCash.total),
                byMethod: cash.byMethod,
              },
              byNature: cur.revenue.byNature,
              avgTicket: cur.avgTicket,
              invoiceCount: cur.invoiceCount,
              acceptance: quoteAcceptance(quotes),
              daily,
              margins: financial
                ? {
                    grossMargin: cur.margins.grossMargin,
                    grossRate: cur.margins.grossRate,
                    estimated: cur.margins.estimated.parts || cur.margins.estimated.labor,
                    subcontractUncosted: cur.margins.subcontractUncosted,
                  }
                : null,
            };
          })()
        : null;

      return {
        period: { preset: period.preset, fromDate: period.fromDate, toDate: period.toDate },
        mode: org.operatingMode,
        hasInvoices: invoiceCount > 0,
        sales,
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
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
      const period = periodOf(input, now, org.timezone);
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
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
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
      const period = periodOf(input, now, org.timezone);
      const [cash, fneFailed, fneFailedCount, promises] = await Promise.all([
        collected(tenantDb, scope, period.from, period.to),
        tenantDb.invoice.findMany({
          where: { ...invoiceSiteWhere(scope), fneStatus: "FAILED" },
          select: { id: true, number: true, total: true, fneError: true, issuedAt: true },
          orderBy: { issuedAt: "desc" },
          take: 5,
        }),
        tenantDb.invoice.count({ where: { ...invoiceSiteWhere(scope), fneStatus: "FAILED" } }),
        // Promesses (M09) : non rattachées à un site → « Tous les sites » seulement (RG-M12-02).
        scope.siteIds
          ? Promise.resolve(null)
          : tenantDb.paymentPromise.findMany({
              where: { status: "PENDING", promisedDate: asOfDate(today) },
              select: {
                id: true,
                amount: true,
                collectionCase: {
                  select: { id: true, customer: { select: { displayName: true } } },
                },
              },
              take: 20,
            }),
      ]);
      return {
        hasInvoices: invoiceCount > 0,
        receivables,
        dso: dso(receivables.total, revenueTtc90d),
        topUnpaid: topUnpaid(invoices, today, 10),
        collected: cash,
        fneFailed: { count: fneFailedCount, invoices: fneFailed },
        promisesToday: promises
          ? promises.map((p) => ({
              id: p.id,
              amount: p.amount,
              caseId: p.collectionCase.id,
              customerName: p.collectionCase.customer.displayName,
            }))
          : null,
        computedAt: now,
      };
    }),

  /** Onglet Atelier (US-M12-03) : OR par statut, retards, occupation du jour, mécaniciens 7 j. */
  workshop: requirePermission("repair_order:read")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      assertNotMechanic(ctx);
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
      const today = localDay(now, org.timezone);
      const todayStart = startOfLocalDay(today, org.timezone);
      const tomorrow = shiftDay(today, 1);
      const tomorrowStart = startOfLocalDay(tomorrow, org.timezone);
      const roWhere: Prisma.RepairOrderWhereInput = { ...siteFilter(scope), deletedAt: null };
      const orSelect = {
        id: true,
        number: true,
        status: true,
        promisedAt: true,
        waitingPartsSince: true,
        vehicle: { select: { plate: true } },
        customer: { select: { displayName: true } },
      } as const;
      const lateWhere: Prisma.RepairOrderWhereInput = {
        ...roWhere,
        promisedAt: { lt: now },
        status: { in: [...RO_IN_PROGRESS_STATUSES].filter((s) => s !== "READY") },
      };
      const partsWhere: Prisma.RepairOrderWhereInput = {
        ...roWhere,
        status: "WAITING_PARTS",
        waitingPartsSince: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
      };
      const [byStatus, late, lateCount, waitingParts, waitingPartsCount, workload, sites] =
        await Promise.all([
          tenantDb.repairOrder.groupBy({
            by: ["status"],
            where: { ...roWhere, status: { in: [...RO_IN_PROGRESS_STATUSES] } },
            _count: { _all: true },
          }),
          tenantDb.repairOrder.findMany({
            where: lateWhere,
            select: orSelect,
            orderBy: { promisedAt: "asc" },
            take: 10,
          }),
          tenantDb.repairOrder.count({ where: lateWhere }),
          tenantDb.repairOrder.findMany({
            where: partsWhere,
            select: orSelect,
            orderBy: { waitingPartsSince: "asc" },
            take: 10,
          }),
          tenantDb.repairOrder.count({ where: partsWhere }),
          workloadBySite(tenantDb, ctx.organizationId, scope, todayStart, tomorrowStart),
          sitesWithCapacity(tenantDb, scope, { fromDate: today, toDate: tomorrow }, org.timezone),
        ]);
      const known = sites.filter((s) => s.capacity !== null);
      const sum = (f: (id: string) => number) => known.reduce((acc, s) => acc + f(s.id), 0);
      const occ = occupancy(
        sum((id) => workload.get(id)?.workedMinutes ?? 0),
        sum((id) => workload.get(id)?.plannedMinutes ?? 0),
        known.length ? known.reduce((acc, s) => acc + (s.capacity ?? 0), 0) : null,
      );
      const mechanics = ctx.permissions.has("workshop:productivity")
        ? await tenantDb.transaction((tx) =>
            loadProductivity(tx, {
              timeZone: org.timezone,
              from: startOfLocalDay(shiftDay(today, -6), org.timezone),
              to: tomorrowStart,
              siteId: input.siteId,
              repairOrderWhere: siteFilter(scope),
              now,
            }),
          )
        : null;
      const toRow = (r: (typeof late)[number]) => ({
        id: r.id,
        number: r.number,
        status: r.status,
        promisedAt: r.promisedAt,
        waitingPartsSince: r.waitingPartsSince,
        plate: r.vehicle.plate,
        customerName: r.customer.displayName,
      });
      return {
        statusCounts: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
        late: { count: lateCount, orders: late.map(toRow) },
        waitingParts: { count: waitingPartsCount, orders: waitingParts.map(toRow) },
        occupancy: occ,
        sitesWithoutHours: sites.filter((s) => s.capacity === null).map((s) => s.name),
        mechanics: mechanics?.map((m) => ({
          membershipId: m.membershipId,
          name: m.name,
          presenceH: m.presenceH,
          workedH: m.workedH,
          billedH: m.billedH,
          efficiency: m.efficiency,
          productivity: m.productivity,
          toCheck: m.toCheck,
        })),
        computedAt: now,
      };
    }),

  /** Onglet Accueil (US-M12-04) — chaque bloc filtré par la permission de lecture du module. */
  frontDesk: orgProcedure.input(dashboardInputSchema).query(async ({ ctx, input }) => {
    assertNotMechanic(ctx);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const scope = resolveSiteScope(ctx, input.siteId);
    const org = await loadOrgReportContext(ctx.organizationId);
    const now = reportsNow();
    const today = localDay(now, org.timezone);
    const todayStart = startOfLocalDay(today, org.timezone);
    const tomorrowStart = startOfLocalDay(shiftDay(today, 1), org.timezone);
    const can = (p: string) => ctx.permissions.has(p as never);
    const quoteWhere: Prisma.QuoteWhereInput = {
      ...siteFilter(scope),
      status: { in: ["SENT", "VIEWED"] },
      supersededAt: null,
      deletedAt: null,
      sentAt: { lt: new Date(now.getTime() - 48 * 60 * 60 * 1000) },
    };
    const reminderWhere: Prisma.ReminderWhereInput = {
      ...reminderSiteWhere(scope),
      status: "NEEDS_APPROVAL",
    };
    const [appointments, reminders, remindersCount, quotes, quotesCount, ready, unread] =
      await Promise.all([
        can("appointment:read")
          ? tenantDb.appointment.findMany({
              where: { ...siteFilter(scope), startsAt: { gte: todayStart, lt: tomorrowStart } },
              select: {
                id: true,
                startsAt: true,
                status: true,
                customer: { select: { displayName: true } },
                vehicle: { select: { plate: true } },
              },
              orderBy: { startsAt: "asc" },
              take: 50,
            })
          : null,
        can("reminder:read")
          ? tenantDb.reminder.findMany({
              where: reminderWhere,
              select: {
                id: true,
                type: true,
                scheduledFor: true,
                customer: { select: { displayName: true } },
              },
              orderBy: { scheduledFor: "asc" },
              take: 5,
            })
          : null,
        can("reminder:read") ? tenantDb.reminder.count({ where: reminderWhere }) : null,
        can("quote:read")
          ? tenantDb.quote.findMany({
              where: quoteWhere,
              select: {
                id: true,
                number: true,
                total: true,
                sentAt: true,
                customer: { select: { displayName: true } },
              },
              orderBy: { sentAt: "asc" },
              take: 10,
            })
          : null,
        can("quote:read") ? tenantDb.quote.count({ where: quoteWhere }) : null,
        can("repair_order:read")
          ? tenantDb.repairOrder.findMany({
              where: { ...siteFilter(scope), status: "READY", deletedAt: null },
              select: {
                id: true,
                number: true,
                readyAt: true,
                vehicle: { select: { plate: true } },
                customer: { select: { displayName: true } },
              },
              orderBy: { readyAt: "asc" },
              take: 20,
            })
          : null,
        // Conversations (M11) : non rattachées à un site → « Tous les sites » seulement.
        can("message:read") && !scope.siteIds
          ? tenantDb.conversation.count({ where: { unreadCount: { gt: 0 } } })
          : null,
      ]);
    return {
      appointments: appointments?.map((a) => ({
        id: a.id,
        startsAt: a.startsAt,
        status: a.status,
        customerName: a.customer.displayName,
        plate: a.vehicle?.plate ?? null,
      })),
      reminders:
        reminders === null
          ? null
          : {
              count: remindersCount ?? 0,
              items: reminders.map((r) => ({
                id: r.id,
                type: r.type,
                customerName: r.customer.displayName,
              })),
            },
      quotes:
        quotes === null
          ? null
          : {
              count: quotesCount ?? 0,
              items: quotes.map((q) => ({
                id: q.id,
                number: q.number,
                total: q.total,
                sentAt: q.sentAt,
                customerName: q.customer.displayName,
              })),
            },
      ready: ready?.map((r) => ({
        id: r.id,
        number: r.number,
        readyAt: r.readyAt,
        plate: r.vehicle.plate,
        customerName: r.customer.displayName,
      })),
      unreadConversations: unread,
      timeZone: org.timezone,
      computedAt: now,
    };
  }),

  /**
   * Onglet « Aujourd'hui » : vue du jour de l'atelier. Comme `frontDesk`, chaque bloc n'est
   * calculé que si le membre a la permission de lecture du module (sinon `null`).
   */
  today: orgProcedure.input(dashboardInputSchema).query(async ({ ctx, input }) => {
    assertNotMechanic(ctx);
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const scope = resolveSiteScope(ctx, input.siteId);
    const org = await loadOrgReportContext(ctx.organizationId);
    const now = reportsNow();
    const today = localDay(now, org.timezone);
    const can = (p: string) => ctx.permissions.has(p as never);
    const [workshop, cash, unpaid, inspections, reminders, claims] = await Promise.all([
      can("repair_order:read") ? loadTodayWorkshop(tenantDb, scope) : null,
      can("payment:read") ? loadTodayCash(tenantDb, scope, today, org.timezone) : null,
      can("receivable:read") || can("report:financial")
        ? loadReceivableInvoices(tenantDb, scope).then((invoices) =>
            summarizeUnpaid(invoices, today),
          )
        : null,
      // Véhicules non rattachés à un site → « Tous les sites » seulement (comme `overview`).
      can("reminder:read") && !scope.siteIds ? loadTodayInspections(tenantDb, today) : null,
      can("reminder:read") ? loadTodayReminders(tenantDb, scope, now, today, org.timezone) : null,
      can("insurance:read") ? loadTodayClaims(tenantDb, scope, today) : null,
    ]);
    return {
      workshop,
      cash,
      unpaid,
      inspections,
      reminders,
      claims,
      today,
      timeZone: org.timezone,
      computedAt: now,
    };
  }),

  /** Onglet Clients (M12 §7) : actifs / nouveaux / perdus (RG-M12-25), top pièces (RG-M12-26). */
  customers: requirePermission("dashboard:owner")
    .input(dashboardInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const scope = resolveSiteScope(ctx, input.siteId);
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
      const period = periodOf(input, now, org.timezone);
      const [activities, parts] = await Promise.all([
        customerActivities(tenantDb, ctx.organizationId, scope, period.to),
        partAggregates(tenantDb, ctx.organizationId, scope, period.from, period.to, 10),
      ]);
      const financial = ctx.permissions.has("report:financial");
      return {
        counts: customerCounts(activities, period.from, period.to),
        topParts: rankTopParts(parts, 10).map((p) => ({
          key: p.key,
          label: p.label,
          quantity: p.quantity,
          ht: p.ht,
          repairOrders: p.repairOrders,
          // §10 : marges jamais renvoyées sans `report:financial`.
          ...(financial ? { margin: p.margin } : {}),
        })),
        computedAt: now,
      };
    }),

  /** CASHIER — « Ma caisse du jour » : encaissements par mode de la session ouverte. */
  cashier: requirePermission("cash:operate").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const session = await tenantDb.cashSession.findFirst({
      where: { openedById: ctx.membership.id, closedAt: null },
      select: { id: true, openedAt: true, openingFloat: true, site: { select: { name: true } } },
      orderBy: { openedAt: "desc" },
    });
    if (!session) return { session: null, total: 0, byMethod: {} as Record<string, number> };
    const payments = await tenantDb.payment.groupBy({
      by: ["method"],
      where: { cashSessionId: session.id, status: "CONFIRMED", voidedAt: null },
      _sum: { amount: true },
    });
    const summary = collectedByMethod(
      payments.map((p) => ({ method: p.method, amount: p._sum.amount ?? 0 })),
    );
    return {
      session: { openedAt: session.openedAt, siteName: session.site.name },
      ...summary,
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
        OR: [
          { type: { startsWith: "alert." } },
          { type: { in: Object.keys(ALERT_NOTIFICATION_TYPES) } },
        ],
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
      data: { readAt: reportsNow() },
    });
    return { count: result.count };
  }),
});

// M12 §8 — résumé quotidien gérant (RG-M12-30) : aperçu du message tel qu'il serait envoyé
// aujourd'hui au membre connecté, et réglages `Organization.settings.digest`.
export const digestRouter = router({
  preview: requirePermission("dashboard:owner").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const org = await loadOrgReportContext(ctx.organizationId);
    const text = await buildDigestForMembership(
      tenantDb,
      { ...org, id: ctx.organizationId },
      { id: ctx.membership.id, siteIds: ctx.membership.siteIds },
      reportsNow(),
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
