"use client";

// M12 §7 — `/rapports` : indicateurs clés de la période, recherche, rapports accessibles
// regroupés par thème (permission vérifiée côté serveur par `reports.catalog`), ouverture
// ou export rapide sur la période choisie, et accès à la comparaison des sites (≥ 2 sites,
// `dashboard:owner`). Période dans l'URL (`?periode=mois`), comme le tableau de bord.
import { Suspense, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarRange,
  Download,
  Hourglass,
  Package,
  PiggyBank,
  Search,
  Send,
  Timer,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { canReadKpi, frenchDay, type KpiCode, type ReportSlug } from "@atelieros/core/reports";
import { EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { CardsSkeleton, ErrorState, KpiCard } from "../tableau-de-bord/parts";
import { formatAmount, L } from "../tableau-de-bord/labels";
import { fmt, R, reportText } from "./labels";

const H = R.hub;

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
type Group = keyof typeof H.groups;

// Préréglages proposés sur la grille ; valeurs d'URL identiques au tableau de bord.
const PERIODS = [
  { value: "month", url: "mois" },
  { value: "prev_month", url: "mois-precedent" },
  { value: "quarter", url: "trimestre" },
  { value: "year", url: "annee" },
] as const;
type Period = (typeof PERIODS)[number]["value"];

const REPORT_META: Record<ReportSlug, { group: Group; icon: Icon }> = {
  ventes: { group: "finance", icon: TrendingUp },
  encaissements: { group: "finance", icon: Wallet },
  "balance-agee": { group: "finance", icon: Hourglass },
  "rentabilite-or": { group: "finance", icon: PiggyBank },
  productivite: { group: "workshop", icon: Timer },
  "stock-valorise": { group: "workshop", icon: Package },
  "top-pieces": { group: "workshop", icon: Trophy },
  relances: { group: "customers", icon: Send },
  clients: { group: "customers", icon: Users },
};

const GROUP_TONE: Record<Group, string> = {
  finance: "bg-accent/10 text-accent",
  workshop: "bg-chan-sms-bg text-chan-sms",
  customers: "bg-chan-whatsapp-bg text-chan-whatsapp",
  network: "bg-chan-email-bg text-chan-email",
};

/** Indicateurs du bandeau et rapport détaillé correspondant. */
const KPIS: { metric: KpiCode; report: ReportSlug }[] = [
  { metric: "revenue_ht", report: "ventes" },
  { metric: "collected", report: "encaissements" },
  { metric: "receivables", report: "balance-agee" },
  { metric: "recovered_by_reminders", report: "relances" },
];

const EXPORTS = [
  { format: "xlsx", label: R.export.xlsx },
  { format: "pdf", label: R.export.pdf },
  { format: "csv", label: R.export.csv },
] as const;

type CatalogPeriod = { from: string; to: string; asOf: string };
type Card = {
  key: string;
  group: Group;
  icon: Icon;
  title: string;
  description: string;
  href: string;
  /** Rapport exportable (absent pour la comparaison des sites). */
  slug?: ReportSlug;
  filter?: "period" | "asOf";
};

export default function RapportsPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Rapports />
    </Suspense>
  );
}

function Rapports() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const period: Period = PERIODS.find((p) => p.url === params.get("periode"))?.value ?? "month";
  const [query, setQuery] = useState("");

  const me = trpc.me.get.useQuery();
  const q = trpc.reports.catalog.useQuery({ period }, { placeholderData: (prev) => prev });

  function selectPeriod(next: Period) {
    const search = new URLSearchParams(params.toString());
    const url = PERIODS.find((p) => p.value === next)?.url;
    if (next === "month" || !url) search.delete("periode");
    else search.set("periode", url);
    const qs = search.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const cards = useMemo<Card[]>(() => {
    if (!q.data) return [];
    const list: Card[] = q.data.reports.map((r) => {
      const text = reportText(r.slug);
      return {
        key: r.slug,
        slug: r.slug,
        filter: r.filter,
        ...REPORT_META[r.slug],
        title: text.title,
        description: text.description,
        href: reportHref(r.slug, r.filter, q.data.period),
      };
    });
    if (q.data.compareSites) {
      list.push({
        key: "comparaison-sites",
        group: "network",
        icon: Building2,
        title: R.compareSites,
        description: R.compareSitesDescription,
        href: "/rapports/comparaison-sites",
      });
    }
    return list;
  }, [q.data]);

  const needle = normalize(query.trim());
  const visible = needle
    ? cards.filter((c) => normalize(`${c.title} ${c.description}`).includes(needle))
    : cards;
  const groups = (Object.keys(H.groups) as Group[])
    .map((group) => ({ group, items: visible.filter((c) => c.group === group) }))
    .filter((g) => g.items.length > 0);

  const permissions = new Set(me.data?.permissions ?? []);
  const accessible = new Set(q.data?.reports.map((r) => r.slug) ?? []);
  const kpis = KPIS.filter((k) => canReadKpi(k.metric, permissions));

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-20">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{R.title}</h1>
          <p className="text-sm text-muted">{R.description}</p>
        </div>
        <div
          role="radiogroup"
          aria-label={H.period}
          className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 lg:w-auto"
        >
          {PERIODS.map((p) => {
            const active = p.value === period;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectPeriod(p.value)}
                className={`min-h-11 flex-1 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors lg:flex-none ${
                  active
                    ? "bg-primary text-primary-foreground shadow-brand-sm"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {L.periods[p.value]}
              </button>
            );
          })}
        </div>
      </header>

      {kpis.length > 0 && (
        <section aria-labelledby="reports-kpis" className="flex flex-col gap-2">
          <h2
            id="reports-kpis"
            className="text-sm font-semibold uppercase tracking-wide text-muted"
          >
            {H.kpiTitle}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {kpis.map((k) => (
              <ReportKpi
                key={k.metric}
                metric={k.metric}
                period={period}
                href={
                  accessible.has(k.report) && q.data
                    ? reportHref(
                        k.report,
                        k.metric === "receivables" ? "asOf" : "period",
                        q.data.period,
                      )
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {q.isLoading ? (
        <CardsSkeleton />
      ) : q.isError || !q.data ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : cards.length === 0 ? (
        <EmptyState title={R.noAccess} />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-sm">
              <span className="sr-only">{H.searchLabel}</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={H.search}
                className="min-h-11 w-full rounded-lg border border-border bg-surface pr-11 pl-9 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={H.clearSearch}
                  className="absolute top-0 right-0 flex size-11 items-center justify-center text-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </label>
            <p className="text-sm text-muted" aria-live="polite">
              {fmt(H.count, { count: visible.length })}
            </p>
          </div>

          {groups.length === 0 ? (
            <EmptyState title={fmt(H.noMatch, { query: query.trim() })} />
          ) : (
            groups.map(({ group, items }) => (
              <section
                key={group}
                aria-labelledby={`group-${group}`}
                className="flex flex-col gap-2"
              >
                <h2 id={`group-${group}`} className="text-sm font-semibold text-muted">
                  {H.groups[group]}
                </h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((card) => (
                    <li key={card.key}>
                      <ReportCard card={card} period={q.data.period} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ReportKpi({ metric, period, href }: { metric: KpiCode; period: Period; href?: string }) {
  const snapshot = metric === "receivables";
  const k = trpc.dashboard.kpi.useQuery(
    { metric, period, compare: !snapshot },
    { retry: false, placeholderData: (prev) => prev },
  );
  if (k.isLoading) return <div className="h-28 animate-pulse rounded-xl bg-surface-2" />;
  if (k.isError || !k.data) return null;
  const value = k.data.value;
  return (
    <KpiCard
      label={H.kpis[metric as keyof typeof H.kpis]}
      value={value === null ? L.dash : formatAmount(value)}
      sub={
        snapshot
          ? H.snapshot
          : typeof k.data.previous === "number"
            ? fmt(H.previous, { amount: formatAmount(k.data.previous) })
            : undefined
      }
      variation={k.data.delta}
      href={href}
    />
  );
}

function ReportCard({ card, period }: { card: Card; period: CatalogPeriod }) {
  const Icon = card.icon;
  const range =
    card.filter === "asOf"
      ? fmt(H.asOfDate, { date: frenchDay(period.asOf) })
      : card.filter === "period"
        ? fmt(H.periodRange, { from: frenchDay(period.from), to: frenchDay(period.to) })
        : null;
  return (
    <article className="group relative flex h-full min-h-40 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-brand-sm transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-brand-md focus-within:border-accent/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${GROUP_TONE[card.group]}`}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Lien étiré : toute la carte est cliquable, les exports restent au-dessus. */}
          <Link
            href={card.href}
            className="font-semibold after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
          >
            {card.title}
          </Link>
          <p className="text-sm text-muted">{card.description}</p>
        </div>
        <ArrowRight
          className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent motion-reduce:transition-none"
          aria-hidden
        />
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {range ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <CalendarRange className="size-3.5" aria-hidden />
            {range}
          </span>
        ) : (
          <span className="text-xs font-medium text-accent">{H.open}</span>
        )}
        {card.slug && card.filter && (
          <div className="relative z-10 flex gap-1">
            {EXPORTS.map((e) => (
              <a
                key={e.format}
                href={exportHref(card.slug!, card.filter!, period, e.format)}
                aria-label={fmt(H.exportAria, { report: card.title, format: e.label })}
                title={fmt(H.exportAria, { report: card.title, format: e.label })}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:bg-surface-2 hover:text-foreground sm:min-h-8"
              >
                <Download className="size-3.5" aria-hidden />
                {e.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function reportHref(slug: ReportSlug, filter: "period" | "asOf", p: CatalogPeriod): string {
  const search =
    filter === "asOf"
      ? new URLSearchParams({ situation: p.asOf })
      : new URLSearchParams({ du: p.from, au: p.to });
  return `/rapports/${slug}?${search.toString()}`;
}

function exportHref(
  slug: ReportSlug,
  filter: "period" | "asOf",
  p: CatalogPeriod,
  format: string,
): string {
  const search =
    filter === "asOf"
      ? new URLSearchParams({ asOf: p.asOf, format })
      : new URLSearchParams({ from: p.from, to: p.to, format });
  return `/api/rapports/${slug}?${search.toString()}`;
}

/** Recherche insensible à la casse et aux accents (« relances » trouve « Relances »). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}
