// M12 — indicateurs composés partagés par le tableau de bord, les rapports et la comparaison
// des sites (une seule définition par indicateur, M12 §1).
import {
  averageTicket,
  computeMargins,
  computeRevenue,
  laborCostOf,
  signedAmount,
  daysOf,
} from "@atelieros/core";
import {
  invoiceCount,
  laborMinutesOfInvoicedOrders,
  revenueAggregates,
  revenueByDay,
  type SiteScope,
  type TenantDb,
} from "./facts";

export async function salesMetrics(
  t: TenantDb,
  organizationId: string,
  org: { defaultMechanicHourlyCost: number },
  scope: SiteScope,
  from: Date,
  to: Date,
) {
  const [rows, count, labor] = await Promise.all([
    revenueAggregates(t, organizationId, scope, from, to),
    invoiceCount(t, scope, from, to),
    laborMinutesOfInvoicedOrders(t, organizationId, scope, from, to),
  ]);
  const revenue = computeRevenue(rows);
  const laborCost = laborCostOf(labor, org.defaultMechanicHourlyCost);
  return {
    revenue,
    invoiceCount: count,
    avgTicket: averageTicket(revenue.ht, count),
    margins: computeMargins(revenue, laborCost),
    laborCost,
  };
}

/**
 * Graphique « CA HT par jour » (barres) vs période précédente (ligne), alignés jour à jour
 * (1er jour de la période ↔ 1er jour de la comparaison).
 */
export async function dailyRevenue(
  t: TenantDb,
  organizationId: string,
  scope: SiteScope,
  period: {
    from: Date;
    to: Date;
    previousFrom: Date;
    previousTo: Date;
    fromDate: string;
    toDate: string;
    previousFromDate: string;
    previousToDate: string;
  },
  timeZone: string,
) {
  const rows = await revenueByDay(
    t,
    organizationId,
    scope,
    period.previousFrom,
    period.to,
    timeZone,
  );
  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + signedAmount(r.invoiceType, r.subtotal));
  }
  const previousDays = daysOf(period.previousFromDate, period.previousToDate);
  return daysOf(period.fromDate, period.toDate).map((day, i) => ({
    day,
    ht: byDay.get(day) ?? 0,
    previousHt: previousDays[i] ? (byDay.get(previousDays[i]) ?? 0) : null,
  }));
}
