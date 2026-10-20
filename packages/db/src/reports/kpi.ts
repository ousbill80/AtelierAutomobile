// M12 §8 `dashboard.kpi` — chargement des faits d'un indicateur isolé (mêmes fonctions que le
// tableau de bord) ; l'assemblage reste dans `core/reports/kpi`. Utilisé par le routeur
// `dashboard` et par l'outil `get_kpi` de l'assistant M17.
import {
  computeReceivables,
  kpiResult,
  localDay,
  quoteAcceptance,
  recoveredByReminders,
  type KpiCode,
  type KpiPeriodFacts,
  type KpiResult,
  type ResolvedPeriod,
} from "@atelieros/core";
import {
  collected,
  loadAttributions,
  loadReceivableInvoices,
  quoteDecisions,
  type SiteScope,
  type TenantDb,
} from "./facts";
import { salesMetrics } from "./metrics";

type Window = { from: Date; to: Date; fromDate: string; toDate: string };

async function factsFor(
  t: TenantDb,
  organizationId: string,
  org: { defaultMechanicHourlyCost: number },
  metric: KpiCode,
  scope: SiteScope,
  window: Window,
): Promise<KpiPeriodFacts> {
  switch (metric) {
    case "revenue_ht":
    case "revenue_ttc":
    case "parts_margin":
    case "labor_margin":
    case "gross_margin":
    case "avg_ticket": {
      const sales = await salesMetrics(t, organizationId, org, scope, window.from, window.to);
      return {
        revenue: sales.revenue,
        margins: sales.margins,
        invoiceCount: sales.invoiceCount,
        avgTicket: sales.avgTicket,
      };
    }
    case "collected":
      return { collected: (await collected(t, scope, window.from, window.to)).total };
    case "recovered_by_reminders": {
      const attributions = await loadAttributions(t, scope, window.from, window.to);
      return { recovered: recoveredByReminders(attributions, window.from, window.to) };
    }
    case "quote_acceptance":
      return { acceptance: quoteAcceptance(await quoteDecisions(t, scope, window)) };
    case "receivables":
      return {};
  }
}

/**
 * Valeur d'un indicateur sur une période (et la précédente si `compare`). Le contrôle des
 * permissions (`core/reports/kpi` `canReadKpi`) et du périmètre de sites reste à l'appelant.
 */
export async function computeKpi(
  t: TenantDb,
  input: {
    organizationId: string;
    org: { defaultMechanicHourlyCost: number; timezone: string };
    metric: KpiCode;
    scope: SiteScope;
    period: ResolvedPeriod;
    now: Date;
    compare?: boolean;
  },
): Promise<KpiResult> {
  const { metric, scope, period } = input;
  if (metric === "receivables") {
    // RG-M12-17 : instantané (pas de période ni de comparaison).
    const invoices = await loadReceivableInvoices(t, scope);
    const summary = computeReceivables(invoices, localDay(input.now, input.org.timezone));
    return kpiResult(metric, { receivablesTotal: summary.total });
  }
  const current = await factsFor(t, input.organizationId, input.org, metric, scope, period);
  if (!input.compare) return kpiResult(metric, current);
  const previous = await factsFor(t, input.organizationId, input.org, metric, scope, {
    from: period.previousFrom,
    to: period.previousTo,
    fromDate: period.previousFromDate,
    toDate: period.previousToDate,
  });
  return kpiResult(metric, current, previous);
}
