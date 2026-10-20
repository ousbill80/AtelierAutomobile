"use client";

// US-M12-07 — `/rapports/comparaison-sites` : sites × indicateurs, ligne « Réseau », tri par
// colonne, meilleur site en gras + icône + texte (jamais la couleur seule). Calculs serveur
// (`reports.compareSites`, `core/reports/sites`).
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SITE_METRICS, type SiteMetric } from "@atelieros/core/reports";
import { EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { formatAmount, L } from "../../tableau-de-bord/labels";
import { CardsSkeleton, ErrorState, formatPct } from "../../tableau-de-bord/parts";
import { PERIODS, type Period } from "../../tableau-de-bord/tabs";
import { R } from "../labels";

const M = R.sites.metrics;
const MONEY: ReadonlySet<SiteMetric> = new Set(["revenueHt", "avgTicket", "receivables"]);
const RATE: ReadonlySet<SiteMetric> = new Set([
  "grossRate",
  "acceptanceRate",
  "occupancy",
  "efficiency",
]);

function formatMetric(metric: SiteMetric, value: number | null): string {
  if (value === null) return L.dash;
  if (MONEY.has(metric)) return formatAmount(value);
  if (RATE.has(metric)) return formatPct(metric === "occupancy" ? Math.min(1, value) : value);
  if (metric === "dso") return `${value} j`;
  return String(value);
}

export default function ComparaisonSitesPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Comparison />
    </Suspense>
  );
}

function Comparison() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("periode");
  const period: Period = (PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as Period)
    : "month";
  const q = trpc.reports.compareSites.useQuery({ period });
  const [sortBy, setSortBy] = useState<SiteMetric>("revenueHt");

  const sorted = q.data
    ? [...q.data.sites].sort(
        (a, b) =>
          (q.data!.ranks[a.siteId]?.[sortBy] ?? 99) - (q.data!.ranks[b.siteId]?.[sortBy] ?? 99),
      )
    : [];
  const best = (metric: SiteMetric, siteId: string) => q.data?.best[metric] === siteId;
  const value = (metric: SiteMetric, siteId: string, v: number | null) =>
    best(metric, siteId) ? (
      <strong>
        <span aria-hidden="true">★ </span>
        {formatMetric(metric, v)}
        <span className="sr-only"> ({R.sites.best})</span>
      </strong>
    ) : (
      formatMetric(metric, v)
    );

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-20">
      <div>
        <Link href="/rapports" className="text-sm underline">
          ← {R.back}
        </Link>
        <h1 className="text-2xl font-semibold">{R.compareSites}</h1>
        <p className="text-sm text-muted">{R.compareSitesDescription}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          {R.filters.period}
          <select
            aria-label={R.filters.period}
            value={period}
            onChange={(e) => router.replace(`${pathname}?periode=${e.target.value}`)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {L.periods[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          {R.sites.sortBy}
          <select
            aria-label={R.sites.sortBy}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SiteMetric)}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
          >
            {SITE_METRICS.map((m) => (
              <option key={m} value={m}>
                {M[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading ? (
        <CardsSkeleton />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : q.data.sites.length < 2 ? (
        <EmptyState title={R.sites.notEnoughSites} />
      ) : (
        <>
          <ul className="flex flex-col gap-2 sm:hidden">
            {sorted.map((s) => (
              <li key={s.siteId} className="rounded-lg border border-border bg-surface p-3 text-sm">
                <p className="font-semibold">{s.name}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                  {SITE_METRICS.map((m) => (
                    <div key={m} className="min-w-0">
                      <dt className="truncate text-xs text-muted">{M[m]}</dt>
                      <dd>{value(m, s.siteId, s.values[m])}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
            <li className="rounded-lg border-2 border-border bg-surface-2 p-3 text-sm">
              <p className="font-semibold">{R.sites.network}</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                {SITE_METRICS.map((m) => (
                  <div key={m} className="min-w-0">
                    <dt className="truncate text-xs text-muted">{M[m]}</dt>
                    <dd>{formatMetric(m, q.data!.network[m])}</dd>
                  </div>
                ))}
              </dl>
            </li>
          </ul>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2">
                    {R.filters.site}
                  </th>
                  {SITE_METRICS.map((m) => (
                    <th key={m} scope="col" className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSortBy(m)}
                        aria-pressed={sortBy === m}
                        className="min-h-11 underline-offset-2 hover:underline"
                      >
                        {M[m]}
                        {sortBy === m ? " ▼" : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.siteId} className="border-b border-border">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {s.name}
                    </th>
                    {SITE_METRICS.map((m) => (
                      <td key={m} className="whitespace-nowrap px-3 py-2 text-right">
                        {value(m, s.siteId, s.values[m])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2 font-semibold">
                  <th scope="row" className="px-3 py-2 text-left">
                    {R.sites.network}
                  </th>
                  {SITE_METRICS.map((m) => (
                    <td key={m} className="whitespace-nowrap px-3 py-2 text-right">
                      {formatMetric(m, q.data!.network[m])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
