// US-M12-07 — comparaison multi-sites : chaque site porte ses numérateurs / dénominateurs ; la
// ligne « Réseau » est recalculée depuis leurs sommes (jamais une moyenne de ratios), puis
// chaque indicateur est classé (meilleur site en gras + icône à l'écran).
import { dso } from "../dashboard/receivables";
import { averageTicket, ratio } from "./revenue";

export interface SiteFacts {
  siteId: string;
  name: string;
  revenueHt: number;
  grossMargin: number;
  invoiceCount: number;
  repairOrders: number;
  quotesAccepted: number;
  quotesDecided: number;
  workedMinutes: number;
  /** null : site sans horaires d'ouverture. */
  capacityMinutes: number | null;
  soldHours: number;
  /** Heures pointées sur les lignes vendues (dénominateur de l'efficacité). */
  workedHoursOnSold: number;
  receivables: number;
  revenueTtc90d: number;
}

export const SITE_METRICS = [
  "revenueHt",
  "grossRate",
  "avgTicket",
  "repairOrders",
  "acceptanceRate",
  "occupancy",
  "efficiency",
  "receivables",
  "dso",
] as const;
export type SiteMetric = (typeof SITE_METRICS)[number];

/** Sens du classement : l'encours et le DSO sont meilleurs quand ils sont bas. */
const LOWER_IS_BETTER: ReadonlySet<SiteMetric> = new Set(["receivables", "dso"]);

export type SiteMetricValues = Record<SiteMetric, number | null>;

export function siteMetricValues(f: Omit<SiteFacts, "siteId" | "name">): SiteMetricValues {
  return {
    revenueHt: f.revenueHt,
    grossRate: ratio(f.grossMargin, f.revenueHt),
    avgTicket: averageTicket(f.revenueHt, f.invoiceCount),
    repairOrders: f.repairOrders,
    acceptanceRate: ratio(f.quotesAccepted, f.quotesDecided),
    occupancy: f.capacityMinutes ? f.workedMinutes / f.capacityMinutes : null,
    efficiency: ratio(f.soldHours, f.workedHoursOnSold),
    receivables: f.receivables,
    dso: dso(f.receivables, f.revenueTtc90d),
  };
}

export interface SiteComparison {
  sites: { siteId: string; name: string; values: SiteMetricValues }[];
  network: SiteMetricValues;
  /** Meilleur site par indicateur (null si aucune valeur ou égalité générale). */
  best: Record<SiteMetric, string | null>;
  /** Rang (1 = meilleur) de chaque site par indicateur. */
  ranks: Record<string, Partial<Record<SiteMetric, number>>>;
}

export function compareSites(sites: readonly SiteFacts[]): SiteComparison {
  const rows = sites.map((s) => ({ siteId: s.siteId, name: s.name, values: siteMetricValues(s) }));
  const sum = (key: keyof SiteFacts) =>
    sites.reduce((acc, s) => acc + ((s[key] as number | null) ?? 0), 0);
  const capacities = sites.map((s) => s.capacityMinutes).filter((c): c is number => c !== null);
  const network = siteMetricValues({
    revenueHt: sum("revenueHt"),
    grossMargin: sum("grossMargin"),
    invoiceCount: sum("invoiceCount"),
    repairOrders: sum("repairOrders"),
    quotesAccepted: sum("quotesAccepted"),
    quotesDecided: sum("quotesDecided"),
    // Occupation réseau : seulement les sites dont la capacité est connue.
    workedMinutes: sites
      .filter((s) => s.capacityMinutes !== null)
      .reduce((acc, s) => acc + s.workedMinutes, 0),
    capacityMinutes: capacities.length ? capacities.reduce((a, b) => a + b, 0) : null,
    soldHours: sum("soldHours"),
    workedHoursOnSold: sum("workedHoursOnSold"),
    receivables: sum("receivables"),
    revenueTtc90d: sum("revenueTtc90d"),
  });
  const best = {} as Record<SiteMetric, string | null>;
  const ranks: SiteComparison["ranks"] = Object.fromEntries(rows.map((r) => [r.siteId, {}]));
  for (const metric of SITE_METRICS) {
    const lower = LOWER_IS_BETTER.has(metric);
    const valued = rows
      .filter((r) => r.values[metric] !== null)
      .sort((a, b) => {
        const d = (a.values[metric] as number) - (b.values[metric] as number);
        return lower ? d : -d;
      });
    valued.forEach((r, i) => {
      // Ex æquo : même rang que le précédent.
      const prev = valued[i - 1];
      const rank =
        prev && prev.values[metric] === r.values[metric] ? ranks[prev.siteId]![metric]! : i + 1;
      ranks[r.siteId]![metric] = rank;
    });
    const top = valued[0];
    const allEqual =
      valued.length > 1 && valued.every((r) => r.values[metric] === top?.values[metric]);
    best[metric] = top && !allEqual ? top.siteId : null;
  }
  return { sites: rows, network, best, ranks };
}
