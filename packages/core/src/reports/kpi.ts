// M12 §8 `dashboard.kpi` — un indicateur isolé, avec la même définition que le tableau de bord
// (M12 §1 : une seule formule par indicateur), utilisé par l'assistant M17 (`get_kpi`).
// Ce module ne fait qu'assembler des faits déjà calculés par `core/reports` et `core/dashboard` ;
// aucune formule n'y est réécrite.
import type { Permission } from "../auth/permissions";
import { variation, type Variation } from "../dashboard/period";
import type { QuoteAcceptance } from "./operations";
import type { MarginSummary, RevenueSummary } from "./revenue";

export const KPI_CODES = [
  "revenue_ht",
  "revenue_ttc",
  "parts_margin",
  "labor_margin",
  "gross_margin",
  "avg_ticket",
  "collected",
  "receivables",
  "recovered_by_reminders",
  "quote_acceptance",
] as const;
export type KpiCode = (typeof KPI_CODES)[number];

/** Indicateurs à l'instant présent (sans période ni comparaison). */
export const SNAPSHOT_KPIS: ReadonlySet<KpiCode> = new Set(["receivables"]);

/** Indicateurs de marge : jamais renvoyés sans `report:financial` (M12 §10). */
export const MARGIN_KPIS: ReadonlySet<KpiCode> = new Set([
  "parts_margin",
  "labor_margin",
  "gross_margin",
]);

/**
 * M12 §10 — permissions donnant accès à chaque indicateur (l'une suffit). Les marges exigent
 * toujours `report:financial` ; les cartes de la Synthèse sont aussi ouvertes à
 * `dashboard:owner`, les créances à l'onglet Finances, le récupéré à l'onglet Relances.
 */
export const KPI_PERMISSIONS: Record<KpiCode, readonly Permission[]> = {
  revenue_ht: ["report:financial", "dashboard:owner"],
  revenue_ttc: ["report:financial", "dashboard:owner"],
  parts_margin: ["report:financial"],
  labor_margin: ["report:financial"],
  gross_margin: ["report:financial"],
  avg_ticket: ["report:financial", "dashboard:owner"],
  collected: ["report:financial", "dashboard:owner"],
  receivables: ["report:financial", "dashboard:owner"],
  recovered_by_reminders: ["dashboard:owner", "reminder:read"],
  quote_acceptance: ["dashboard:owner", "report:read"],
};

export function canReadKpi(code: KpiCode, permissions: ReadonlySet<string>): boolean {
  return KPI_PERMISSIONS[code].some((p) => permissions.has(p));
}

/** Nature de la valeur, pour l'affichage (le formatage reste au code appelant). */
export const KPI_UNIT: Record<KpiCode, "fcfa" | "rate"> = {
  revenue_ht: "fcfa",
  revenue_ttc: "fcfa",
  parts_margin: "fcfa",
  labor_margin: "fcfa",
  gross_margin: "fcfa",
  avg_ticket: "fcfa",
  collected: "fcfa",
  receivables: "fcfa",
  recovered_by_reminders: "fcfa",
  quote_acceptance: "rate",
};

/** Faits d'une période déjà calculés par `core/reports` / `core/dashboard`. */
export interface KpiPeriodFacts {
  revenue?: RevenueSummary;
  margins?: MarginSummary;
  invoiceCount?: number;
  avgTicket?: number | null;
  collected?: number;
  recovered?: number;
  acceptance?: QuoteAcceptance;
  receivablesTotal?: number;
}

export interface KpiValue {
  /** Montant FCFA, ou taux 0-1 (`quote_acceptance`) ; null si non calculable (division par zéro). */
  value: number | null;
  numerator?: number;
  denominator?: number;
  /** Une marge utilise un coût par défaut (RG-M12-08/09). */
  estimated?: boolean;
}

/** Valeur d'un indicateur à partir des faits de la période (aucune nouvelle formule). */
export function kpiValueOf(code: KpiCode, facts: KpiPeriodFacts): KpiValue {
  switch (code) {
    case "revenue_ht":
      return { value: facts.revenue?.ht ?? 0 };
    case "revenue_ttc":
      return { value: facts.revenue?.ttc ?? 0 };
    case "parts_margin":
      return {
        value: facts.margins?.partsMargin ?? 0,
        numerator: facts.margins?.partsMargin ?? 0,
        denominator: facts.revenue?.byNature.parts ?? 0,
        estimated: facts.margins?.estimated.parts ?? false,
      };
    case "labor_margin":
      return {
        value: facts.margins?.laborMargin ?? 0,
        numerator: facts.margins?.laborMargin ?? 0,
        denominator: facts.revenue?.byNature.labor ?? 0,
        estimated: facts.margins?.estimated.labor ?? false,
      };
    case "gross_margin":
      return {
        value: facts.margins?.grossMargin ?? 0,
        numerator: facts.margins?.grossMargin ?? 0,
        denominator: facts.revenue?.ht ?? 0,
        estimated: !!(facts.margins?.estimated.parts || facts.margins?.estimated.labor),
      };
    case "avg_ticket":
      return {
        value: facts.avgTicket ?? null,
        numerator: facts.revenue?.ht ?? 0,
        denominator: facts.invoiceCount ?? 0,
      };
    case "collected":
      return { value: facts.collected ?? 0 };
    case "receivables":
      return { value: facts.receivablesTotal ?? 0 };
    case "recovered_by_reminders":
      return { value: facts.recovered ?? 0 };
    case "quote_acceptance":
      return {
        value: facts.acceptance?.countRate ?? null,
        numerator: facts.acceptance?.accepted ?? 0,
        denominator: facts.acceptance?.decided ?? 0,
      };
  }
}

export interface KpiResult extends KpiValue {
  metric: KpiCode;
  previous?: number | null;
  /** Variation vs période précédente (mêmes règles que les cartes du tableau de bord). */
  delta?: Variation;
}

/** Assemble le résultat `dashboard.kpi`, avec comparaison si la période précédente est fournie. */
export function kpiResult(
  metric: KpiCode,
  current: KpiPeriodFacts,
  previous?: KpiPeriodFacts,
): KpiResult {
  const value = kpiValueOf(metric, current);
  if (!previous || SNAPSHOT_KPIS.has(metric)) return { metric, ...value };
  const before = kpiValueOf(metric, previous).value;
  return {
    metric,
    ...value,
    previous: before,
    ...(value.value !== null && before !== null ? { delta: variation(value.value, before) } : {}),
  };
}
