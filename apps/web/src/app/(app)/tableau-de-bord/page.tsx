"use client";

// M12 §7 — `/tableau-de-bord`, partie 1 (étape 2.4) : onglets Synthèse (version AutoRappel,
// US-M12-10), Relances et Finances (créances), bloc Alertes (RG-M12-28). Période et site dans
// l'URL (`?periode=mois&site=…`, US-M12-02). Les onglets Atelier / Accueil / Clients et les
// cartes CA / Encaissé arrivent avec la partie 2 (étape 6.1).
import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AssistantFab } from "@/components/assistant-fab";
import type { AppRouter } from "@/server/routers/_app";
import { fmt, formatAmount, formatDay, L, reminderTypeLabel } from "./labels";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Variation = RouterOutputs["dashboard"]["reminders"]["sentVariation"];
type Tab = "summary" | "reminders" | "finances";

const PERIODS = ["today", "7d", "month", "prev_month", "30d"] as const;
type Period = (typeof PERIODS)[number];
// Valeurs d'URL en français (US-M12-02 : `?periode=mois`).
const PERIOD_URL: Record<Period, string> = {
  today: "aujourdhui",
  "7d": "7j",
  month: "mois",
  prev_month: "mois-precedent",
  "30d": "30j",
};
const TAB_URL: Record<Tab, string> = {
  summary: "synthese",
  reminders: "relances",
  finances: "finances",
};

function fromUrl<T extends string>(map: Record<T, string>, value: string | null): T | undefined {
  return (Object.keys(map) as T[]).find((key) => map[key] === value);
}

export default function TableauDeBordPage() {
  return (
    <Suspense fallback={<CardsSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = trpc.me.get.useQuery();

  const permissions = new Set(me.data?.permissions ?? []);
  const tabs: Tab[] = [];
  if (permissions.has("dashboard:owner")) tabs.push("summary");
  if (permissions.has("reminder:read")) tabs.push("reminders");
  if (permissions.has("report:financial")) tabs.push("finances");

  const period = fromUrl(PERIOD_URL, params.get("periode")) ?? "month";
  const requestedTab = fromUrl(TAB_URL, params.get("onglet"));
  const tab = requestedTab && tabs.includes(requestedTab) ? requestedTab : tabs[0];
  const sites = me.data?.allowedSites ?? [];
  const restricted = (me.data?.membership?.siteIds.length ?? 0) > 0;
  const siteParam = params.get("site") ?? undefined;
  const siteId = siteParam ?? (restricted ? sites[0]?.id : undefined);

  function update(next: Record<string, string | undefined>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    router.replace(`${pathname}?${search.toString()}`);
  }

  if (me.isLoading) return <CardsSkeleton />;
  if (me.isError) return <ErrorState onRetry={() => me.refetch()} />;
  if (!tab) return <EmptyState title={L.states.noAccess} />;

  const input = { period, siteId };

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-20">
      <h1 className="text-2xl font-semibold">{L.title}</h1>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-end gap-2 bg-background px-1 py-2">
        <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
          {L.periodLabel}
          <select
            aria-label={L.periodLabel}
            value={period}
            onChange={(e) => update({ periode: PERIOD_URL[e.target.value as Period] })}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {L.periods[p]}
              </option>
            ))}
          </select>
        </label>
        {sites.length > 1 || !restricted ? (
          <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
            {L.siteLabel}
            <select
              aria-label={L.siteLabel}
              value={siteId ?? ""}
              onChange={(e) => update({ site: e.target.value || undefined })}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {!restricted && <option value="">{L.allSites}</option>}
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {tabs.length > 1 && (
        <div role="tablist" className="flex gap-2 overflow-x-auto text-sm">
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              onClick={() => update({ onglet: TAB_URL[t] })}
              className={`min-h-11 shrink-0 rounded-md px-3 ${t === tab ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
            >
              {L.tabs[t]}
            </button>
          ))}
        </div>
      )}

      {tab === "summary" && <SummaryTab input={input} />}
      {tab === "reminders" && <RemindersTab input={input} />}
      {tab === "finances" && <FinancesTab input={input} />}

      <AlertsBlock />
      <AssistantFab />
    </div>
  );
}

type TabInput = { period: Period; siteId?: string };

// ─── Onglet Synthèse (version AutoRappel) ─────────────────────────────────────

function SummaryTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.overview.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={L.cards.receivables}
          value={d.hasInvoices ? formatAmount(d.receivables.total) : L.dash}
          sub={
            d.hasInvoices
              ? fmt(L.cards.receivablesOver30, { amount: formatAmount(d.receivables.over30) })
              : undefined
          }
          help={L.help.receivables}
          href="/creances?filtre=en-retard"
        />
        <KpiCard
          label={L.cards.recovered}
          value={formatAmount(d.recovered.value)}
          variation={d.recovered.variation}
          help={L.help.recovered}
        />
        <KpiCard
          label={L.cards.toHandleToday}
          value={String(d.remindersToHandleToday)}
          href="/relances"
        />
        <KpiCard
          label={L.cards.remindersSent}
          value={String(d.reminders.sent)}
          variation={d.reminders.sentVariation}
          sub={`${L.cards.returnedCustomers} : ${d.reminders.returnedCustomers}`}
        />
        <KpiCard
          label={L.cards.inspectionsDue30}
          value={d.inspectionsDue30 === null ? L.dash : String(d.inspectionsDue30)}
          help={d.inspectionsDue30 === null ? L.cards.notAttributable : undefined}
          href="/relances/echeances"
        />
        <KpiCard
          label={L.cards.servicesDueThisMonth}
          value={d.servicesDueThisMonth === null ? L.dash : String(d.servicesDueThisMonth)}
          help={d.servicesDueThisMonth === null ? L.cards.notAttributable : undefined}
          href="/relances/echeances"
        />
      </div>
      {d.hasInvoices ? (
        <TopUnpaid entries={d.topUnpaid} />
      ) : (
        <EmptyState title={L.states.noInvoices} description={L.states.noInvoicesHint} />
      )}
    </div>
  );
}

// ─── Onglet Relances ─────────────────────────────────────────────────────────

function RemindersTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.reminders.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  const isEmpty = d.sent === 0 && d.failed === 0 && d.toApprove === 0 && d.recoveredAmount === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={L.reminders.sent} value={String(d.sent)} variation={d.sentVariation} />
        <KpiCard
          label={L.reminders.recovered}
          value={formatAmount(d.recoveredAmount)}
          variation={d.recoveredVariation}
          help={L.help.recovered}
        />
        <KpiCard label={L.cards.returnedCustomers} value={String(d.returnedCustomers)} />
        <KpiCard label={L.reminders.toApprove} value={String(d.toApprove)} href="/relances" />
      </div>

      {isEmpty ? (
        <EmptyState title={L.states.empty} />
      ) : (
        <>
          <Section title={L.reminders.funnel}>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Stat label={L.reminders.sent} value={d.sent} />
              <Stat label={L.reminders.delivered} value={d.delivered} />
              <Stat label={L.reminders.read} value={d.read} />
              <Stat
                label={L.reminders.failed}
                value={d.failed}
                tone={d.failed > 0 ? "bad" : undefined}
              />
            </dl>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {Object.entries(d.sentByType).map(([type, count]) => (
                <li key={type} className="rounded-full bg-surface-2 px-2.5 py-1">
                  {reminderTypeLabel(type)} : {count}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={L.reminders.returnRate} help={L.help.returnRate}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ReturnRateRow label={L.reminders.returnInspection} rate={d.returnRate.inspection} />
              <ReturnRateRow label={L.reminders.returnService} rate={d.returnRate.service} />
            </div>
            <p className="mt-2 text-xs text-muted">
              {L.reminders.generatedRevenue} : {formatAmount(d.generatedRevenue)}
            </p>
          </Section>

          {d.weekly.length > 0 && (
            <Section title={L.reminders.weekly}>
              <WeeklyBars weeks={d.weekly.slice(-7)} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function ReturnRateRow({
  label,
  rate,
}: {
  label: string;
  rate: { cohort: number; returned: number; pending: number; rate: number | null };
}) {
  return (
    <div className="rounded-md bg-surface-2 p-3">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-2xl font-semibold">
        {rate.rate === null ? L.dash : `${(rate.rate * 100).toFixed(1).replace(".", ",")} %`}
      </p>
      <p className="text-xs text-muted">
        {fmt(L.reminders.returnDetail, {
          returned: rate.returned,
          eligible: rate.cohort - rate.pending,
          pending: rate.pending,
        })}
      </p>
    </div>
  );
}

function WeeklyBars({ weeks }: { weeks: RouterOutputs["dashboard"]["reminders"]["weekly"] }) {
  const max = Math.max(...weeks.map((w) => w.total), 1);
  return (
    <ul className="flex flex-col gap-2">
      {weeks.map((w) => (
        <li key={w.weekStart} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 text-muted">
            {fmt(L.reminders.weekOf, { date: formatDay(w.weekStart) })}
          </span>
          <span
            className="h-3 rounded bg-accent"
            style={{ width: `${(w.total / max) * 100}%` }}
            aria-hidden="true"
          />
          <span className="font-medium">{w.total}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Onglet Finances (créances) ──────────────────────────────────────────────

function FinancesTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.finances.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d.hasInvoices) {
    return <EmptyState title={L.states.noInvoices} description={L.states.noInvoicesHint} />;
  }
  const r = d.receivables;
  const bucketKeys = Object.keys(L.finances.buckets) as (keyof typeof r.buckets)[];
  const max = Math.max(...bucketKeys.map((k) => r.buckets[k]), 1);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={L.cards.receivables}
          value={formatAmount(r.total)}
          sub={fmt(L.cards.receivablesOver30, { amount: formatAmount(r.over30) })}
          help={L.help.receivables}
          href="/creances?filtre=en-retard"
        />
        <KpiCard label={L.finances.overdue} value={formatAmount(r.overdue)} />
        <KpiCard label={L.finances.disputed} value={formatAmount(r.disputed)} />
        <KpiCard
          label={L.finances.dso}
          value={d.dso === null ? L.dash : fmt(L.finances.dsoValue, { days: d.dso })}
          help={L.help.dso}
        />
      </div>
      <Section title={L.finances.aged}>
        <ul className="flex flex-col gap-2">
          {bucketKeys.map((k) => (
            <li key={k} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 text-muted">{L.finances.buckets[k]}</span>
              <span
                className="h-3 rounded bg-accent"
                style={{ width: `${(r.buckets[k] / max) * 60}%` }}
                aria-hidden="true"
              />
              <span className="font-medium">{formatAmount(r.buckets[k])}</span>
            </li>
          ))}
        </ul>
      </Section>
      <TopUnpaid entries={d.topUnpaid} />
    </div>
  );
}

function TopUnpaid({ entries }: { entries: RouterOutputs["dashboard"]["finances"]["topUnpaid"] }) {
  if (entries.length === 0) return null;
  return (
    <Section title={L.finances.topUnpaid}>
      <ul className="divide-y divide-border">
        {entries.map((e) => (
          <li
            key={e.customerId}
            className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm"
          >
            <Link
              href={`/clients/${e.customerId}`}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {e.customerName}
              <span className="block text-xs font-normal text-muted">
                {fmt(L.finances.invoices, { count: e.invoiceCount })} ·{" "}
                {e.maxDaysLate > 0
                  ? fmt(L.finances.daysLate, { days: e.maxDaysLate })
                  : L.finances.notDue}
              </span>
            </Link>
            <span className="shrink-0 font-semibold">{formatAmount(e.balance)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ─── Bloc Alertes (RG-M12-28) ────────────────────────────────────────────────

const SEVERITY_TONE: Record<string, StatusTone> = { critical: "bad", warning: "warn", info: "off" };

function AlertsBlock() {
  const utils = trpc.useUtils();
  const q = trpc.alerts.list.useQuery({ unreadOnly: true, limit: 5 });
  const markRead = trpc.alerts.markRead.useMutation({
    onSuccess: () => utils.alerts.list.invalidate(),
  });
  return (
    <Section title={L.alerts.title}>
      {q.isLoading ? (
        <div className="h-16 animate-pulse rounded-md bg-surface-2" />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-sm text-muted">{L.alerts.empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {q.data.map((a) => {
            const severity = a.severity ?? "info";
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <StatusBadge tone={SEVERITY_TONE[severity] ?? "off"}>
                    {(L.alerts.severity as Record<string, string>)[severity] ?? severity}
                  </StatusBadge>
                  {a.link ? (
                    <Link href={a.link} className="font-medium hover:underline">
                      {a.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{a.title}</span>
                  )}
                  {a.body && <span className="text-xs text-muted">{a.body}</span>}
                </div>
                <Button
                  variant="ghost"
                  onClick={() => markRead.mutate({ ids: [a.id] })}
                  disabled={markRead.isPending}
                >
                  {L.alerts.markRead}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ─── Briques d'affichage ─────────────────────────────────────────────────────

function VariationText({ variation }: { variation: Variation }) {
  if (variation.kind === "none") return null;
  if (variation.kind === "new") {
    return <span className="text-xs text-muted">↗ {L.variation.new}</span>;
  }
  const { pct } = variation;
  if (pct === 0) return <span className="text-xs text-muted">→ {L.variation.flat}</span>;
  const up = pct > 0;
  return (
    <span className={`text-xs ${up ? "text-status-ok" : "text-status-bad"}`}>
      {up ? "▲" : "▼"} {fmt(up ? L.variation.up : L.variation.down, { pct: Math.abs(pct) })}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  variation,
  help,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  variation?: Variation;
  help?: string;
  href?: string;
}) {
  const content = (
    <>
      <span className="flex items-start justify-between gap-1 text-xs text-muted">
        {label}
        {help && (
          <span title={help} aria-label={help} className="cursor-help">
            ⓘ
          </span>
        )}
      </span>
      <span className="text-lg font-semibold leading-tight sm:text-xl">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
      {variation && <VariationText variation={variation} />}
    </>
  );
  const className =
    "flex min-h-24 min-w-0 flex-col gap-1 break-words rounded-lg border border-border bg-surface p-3";
  return href ? (
    <Link href={href} className={`${className} hover:bg-surface-2`} data-testid="kpi-card">
      {content}
    </Link>
  ) : (
    <div className={className} data-testid="kpi-card">
      {content}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: StatusTone }) {
  return (
    <div className="rounded-md bg-surface-2 p-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-semibold">
        {tone ? <StatusBadge tone={tone}>{value}</StatusBadge> : value}
      </dd>
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-1 font-semibold">
        {title}
        {help && (
          <span title={help} aria-label={help} className="cursor-help text-xs text-muted">
            ⓘ
          </span>
        )}
      </h2>
      {children}
    </section>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title={L.states.error}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {L.states.retry}
        </Button>
      }
    />
  );
}
