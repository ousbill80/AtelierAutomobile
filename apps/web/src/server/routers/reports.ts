// M12 §8 — routeur `reports` : catalogue des rapports accessibles, aperçu paginé (50 lignes,
// mêmes lignes et totaux que les exports), comparaison multi-sites (US-M12-07). Chaque rapport
// vérifie sa permission (§10) ; les exports passent par GET /api/rapports/[slug] (AuditLog).
import { TRPCError } from "@trpc/server";
import {
  compareSites,
  OPEN_INVOICE_STATUSES,
  PREVIEW_PAGE_SIZE,
  quoteAcceptance,
  REPORT_SLUGS,
  REPORTS,
  VALID_INVOICE_STATUSES,
  type ReportSlug,
  type SiteFacts,
} from "@atelieros/core";
import { db, reportFacts } from "@atelieros/db";
import { compareSitesInputSchema, reportPreviewInputSchema } from "@atelieros/validators";
import { buildReport } from "../reports/builders";
import {
  loadOrgReportContext,
  reportsNow,
  resolvePeriodInput,
  resolveSiteScope,
} from "../reports/context";
import { orgProcedure, requirePermission, router } from "../trpc";
import type { Permission } from "@atelieros/core";

const {
  quoteDecisions,
  repairOrderCounts,
  salesMetrics,
  sitesWithCapacity,
  soldAndWorkedHours,
  workloadBySite,
} = reportFacts;

/** §10 : un rapport n'est accessible qu'avec sa permission (`report:read` ou `report:financial`). */
export function assertReportPermission(
  ctx: { permissions: Set<Permission> },
  slug: ReportSlug,
): void {
  const permission = REPORTS[slug].permission;
  if (!ctx.permissions.has(permission)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Permission manquante : ${permission}` });
  }
}

export const reportsRouter = router({
  /** `/rapports` : rapports visibles pour le membre et disponibilité de la comparaison. */
  catalog: orgProcedure.query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const activeSites = await tenantDb.site.count({ where: { isActive: true } });
    return {
      reports: REPORT_SLUGS.filter((slug) => ctx.permissions.has(REPORTS[slug].permission)).map(
        (slug) => ({ slug, filter: REPORTS[slug].filter }),
      ),
      compareSites: ctx.permissions.has("dashboard:owner") && activeSites >= 2,
    };
  }),

  preview: orgProcedure.input(reportPreviewInputSchema).query(async ({ ctx, input }) => {
    assertReportPermission(ctx, input.slug);
    const scope = resolveSiteScope(ctx, input.filters.siteId);
    const org = await loadOrgReportContext(ctx.organizationId);
    const result = await buildReport(
      input.slug,
      {
        t: db.forTenant({ organizationId: ctx.organizationId }),
        organizationId: ctx.organizationId,
        org,
        scope,
        filters: input.filters,
        now: reportsNow(),
        financial: ctx.permissions.has("report:financial"),
      },
      { offset: input.cursor, limit: PREVIEW_PAGE_SIZE },
    );
    const next = input.cursor + PREVIEW_PAGE_SIZE;
    return {
      columns: result.columns,
      rows: result.rows,
      totals: result.totals,
      count: result.count,
      notes: result.notes ?? [],
      period: result.period,
      timeZone: org.timezone,
      nextCursor: next < result.count ? next : null,
    };
  }),

  /**
   * US-M12-07 — sites × indicateurs, ligne « Réseau » et classement. Un membre restreint ne voit
   * que ses sites, y compris dans la ligne Réseau (§10).
   */
  compareSites: requirePermission("dashboard:owner")
    .input(compareSitesInputSchema)
    .query(async ({ ctx, input }) => {
      const t = db.forTenant({ organizationId: ctx.organizationId });
      const org = await loadOrgReportContext(ctx.organizationId);
      const now = reportsNow();
      const period = resolvePeriodInput(input.custom ?? input.period, now, org.timezone);
      const scope = resolveSiteScope(ctx, undefined);
      const since90 = new Date(now.getTime() - 90 * 86_400_000);
      const [sites, workload, hours, receivables, revenue90] = await Promise.all([
        sitesWithCapacity(t, scope, period, org.timezone),
        workloadBySite(t, ctx.organizationId, scope, period.from, period.to),
        soldAndWorkedHours(t, ctx.organizationId, scope, period.from, period.to),
        t.invoice.groupBy({
          by: ["siteId"],
          where: {
            ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
            type: "INVOICE",
            billTo: "CUSTOMER",
            status: { in: [...OPEN_INVOICE_STATUSES] },
            balance: { gt: 0 },
          },
          _sum: { balance: true },
        }),
        t.invoice.groupBy({
          by: ["siteId", "type"],
          where: {
            ...(scope.siteIds ? { siteId: { in: scope.siteIds } } : {}),
            type: { in: ["INVOICE", "CREDIT_NOTE"] },
            status: { in: [...VALID_INVOICE_STATUSES] },
            issuedAt: { gte: since90, lte: now },
          },
          _sum: { total: true },
        }),
      ]);
      const facts: SiteFacts[] = await Promise.all(
        sites.map(async (site) => {
          const siteScope = { siteIds: [site.id] };
          const [sales, orders, quotes] = await Promise.all([
            salesMetrics(t, ctx.organizationId, org, siteScope, period.from, period.to),
            repairOrderCounts(t, siteScope, period.from, period.to),
            quoteDecisions(t, siteScope, period),
          ]);
          const acceptance = quoteAcceptance(quotes);
          const siteHours = hours.filter((h) => h.siteId === site.id);
          return {
            siteId: site.id,
            name: site.name,
            revenueHt: sales.revenue.ht,
            grossMargin: sales.margins.grossMargin,
            invoiceCount: sales.invoiceCount,
            repairOrders: orders.opened,
            quotesAccepted: acceptance.accepted,
            quotesDecided: acceptance.decided,
            workedMinutes: workload.get(site.id)?.workedMinutes ?? 0,
            capacityMinutes: site.capacity,
            soldHours: siteHours.reduce((acc, h) => acc + h.sold, 0),
            workedHoursOnSold: siteHours.reduce((acc, h) => acc + h.worked, 0),
            receivables: receivables.find((r) => r.siteId === site.id)?._sum.balance ?? 0,
            revenueTtc90d: revenue90
              .filter((r) => r.siteId === site.id)
              .reduce(
                (acc, r) =>
                  acc +
                  (r.type === "CREDIT_NOTE" ? -Math.abs(r._sum.total ?? 0) : (r._sum.total ?? 0)),
                0,
              ),
          };
        }),
      );
      return {
        period: { fromDate: period.fromDate, toDate: period.toDate },
        ...compareSites(facts),
        computedAt: now,
      };
    }),
});
