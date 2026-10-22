"use client";

// M12 §7 — `/tableau-de-bord` : onglets selon le rôle et les permissions (Synthèse, Atelier,
// Accueil, Finances, Relances, Clients ; CASHIER : « Ma caisse du jour »), version AutoRappel
// en mode REMINDERS_ONLY (US-M12-10), bloc Alertes (RG-M12-28). Période (dont personnalisée)
// et site dans l'URL (`?periode=mois&site=…`, US-M12-02).
import { Suspense, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowUpRight,
  BarChart3,
  BellRing,
  Building2,
  Calendar,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  LayoutDashboard,
  RefreshCw,
  Send,
  Sparkles,
  Users,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { Button, EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AssistantFab } from "@/components/assistant-fab";
import type { AppRouter } from "@/server/routers/_app";
import { fmt, formatAmount, formatDay, L, methodLabel, reminderTypeLabel } from "./labels";
import {
  BarList,
  CardsSkeleton,
  ErrorState,
  formatDateTime,
  KpiCard,
  Section,
  Stat,
} from "./parts";
import {
  CashierCard,
  CustomersTab,
  FrontDeskTab,
  ReceivablesCard,
  SummaryFull,
  WorkshopTab,
  type Period,
  type TabInput,
} from "./tabs";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Tab =
  "summary" | "workshop" | "frontDesk" | "finances" | "reminders" | "customers" | "cashier";

const TAB_ICONS: Record<Tab, ReactNode> = {
  summary: <LayoutDashboard size={15} strokeWidth={2} />,
  workshop: <Wrench size={15} strokeWidth={2} />,
  frontDesk: <Calendar size={15} strokeWidth={2} />,
  finances: <CircleDollarSign size={15} strokeWidth={2} />,
  reminders: <BellRing size={15} strokeWidth={2} />,
  customers: <Users size={15} strokeWidth={2} />,
  cashier: <Wallet size={15} strokeWidth={2} />,
};

// Valeurs d'URL en français (US-M12-02 : `?periode=mois`).
const PERIOD_URL: Record<Period | "custom", string> = {
  today: "aujourdhui",
  "7d": "7j",
  month: "mois",
  prev_month: "mois-precedent",
  "30d": "30j",
  quarter: "trimestre",
  year: "annee",
  custom: "perso",
};
const TAB_URL: Record<Tab, string> = {
  summary: "synthese",
  workshop: "atelier",
  frontDesk: "accueil",
  finances: "finances",
  reminders: "relances",
  customers: "clients",
  cashier: "caisse",
};
/** M12 §7 : onglet par défaut selon le rôle. */
const DEFAULT_TAB: Record<string, Tab> = {
  OWNER: "summary",
  MANAGER: "workshop",
  ADVISOR: "frontDesk",
  ACCOUNTANT: "finances",
  CASHIER: "cashier",
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const permissions = new Set(me.data?.permissions ?? []);
  const role = me.data?.membership?.role ?? "";
  const mode = me.data?.activeOrganization?.operatingMode ?? "FULL";
  const timeZone = me.data?.activeOrganization?.timezone ?? "Africa/Abidjan";
  const full = mode === "FULL";
  const tabs: Tab[] = [];
  // M12 §10 : MECHANIC sans accès (redirigé vers la tablette).
  if (role !== "MECHANIC") {
    if (permissions.has("dashboard:owner")) tabs.push("summary");
    if (full && permissions.has("repair_order:read")) tabs.push("workshop");
    if (
      full &&
      (["appointment:read", "reminder:read", "quote:read"] as const).some((p) => permissions.has(p))
    ) {
      tabs.push("frontDesk");
    }
    if (permissions.has("report:financial")) tabs.push("finances");
    if (permissions.has("reminder:read")) tabs.push("reminders");
    if (full && permissions.has("dashboard:owner")) tabs.push("customers");
    if (full && permissions.has("cash:operate")) tabs.push("cashier");
  }

  const urlPeriod = fromUrl(PERIOD_URL, params.get("periode"));
  const du = params.get("du") ?? "";
  const au = params.get("au") ?? "";
  const custom =
    urlPeriod === "custom" && ISO_DAY.test(du) && ISO_DAY.test(au) && du <= au
      ? { from: du, to: au }
      : undefined;
  const period: Period = urlPeriod && urlPeriod !== "custom" ? urlPeriod : "month";
  const requestedTab = fromUrl(TAB_URL, params.get("onglet"));
  const defaultTab = DEFAULT_TAB[role];
  const tab =
    requestedTab && tabs.includes(requestedTab)
      ? requestedTab
      : defaultTab && tabs.includes(defaultTab)
        ? defaultTab
        : tabs[0];
  const sites = me.data?.allowedSites ?? [];
  const restricted = (me.data?.membership?.siteIds.length ?? 0) > 0;
  const siteParam = params.get("site") ?? undefined;
  const siteId = siteParam ?? (restricted ? sites[0]?.id : undefined);
  const [draft, setDraft] = useState({ from: du, to: au });
  const showCustom = urlPeriod === "custom";

  function update(next: Record<string, string | undefined>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    router.replace(`${pathname}?${search.toString()}`);
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    try {
      await utils.dashboard.invalidate();
    } finally {
      setIsRefreshing(false);
    }
  }

  if (me.isLoading) return <CardsSkeleton />;
  if (me.isError) return <ErrorState onRetry={() => me.refetch()} />;
  if (role === "MECHANIC") {
    return (
      <EmptyState
        title={L.states.noAccess}
        action={
          <Link href="/tablette" className="underline">
            {L.mechanicLink}
          </Link>
        }
      />
    );
  }
  if (!tab) return <EmptyState title={L.states.noAccess} />;

  const input: TabInput = { period, custom, siteId };

  // Périodes rapides sous forme de pills
  const quickPeriods: Period[] = ["today", "7d", "month", "prev_month", "year"];
  const otherPeriods: (Period | "custom")[] = ["30d", "quarter", "custom"];
  const isQuickSelected = !showCustom && quickPeriods.includes(period);

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-20">
      {/* En-tête moderne du tableau de bord */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <LayoutDashboard size={20} strokeWidth={2.4} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{L.title}</h1>
            <p className="text-xs text-muted">Vue d&apos;ensemble et indicateurs clés de votre atelier</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2 disabled:opacity-50"
            title="Rafraîchir les données"
          >
            <RefreshCw size={13} className={isRefreshing ? "animate-spin" : ""} />
            <span>{isRefreshing ? "Actualisation..." : L.refresh}</span>
          </button>

          {(permissions.has("report:read") || permissions.has("report:financial")) && (
            <Link
              href="/rapports"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-xs font-semibold text-foreground transition-all hover:bg-surface-2/80"
            >
              <BarChart3 size={14} />
              <span>{L.reportsLink}</span>
              <ArrowUpRight size={12} className="opacity-70" />
            </Link>
          )}
        </div>
      </div>

      {/* Barre de filtres intelligente et complète */}
      <div className="sticky top-0 z-10 -mx-2 rounded-xl border border-border/70 bg-surface/95 px-3 py-2.5 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Groupe Sélecteur de période */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 text-xs font-semibold text-muted pr-1">
              <CalendarDays size={14} />
              <span>{L.periodLabel} :</span>
            </span>

            {/* Périodes d'accès rapide */}
            {quickPeriods.map((p) => {
              const active = !showCustom && period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    update({
                      periode: PERIOD_URL[p],
                      du: undefined,
                      au: undefined,
                    });
                  }}
                  className={`inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-all ${
                    active
                      ? "bg-accent text-accent-fg font-semibold shadow-xs"
                      : "bg-surface-2/70 text-foreground hover:bg-surface-2"
                  }`}
                >
                  {L.periods[p]}
                </button>
              );
            })}

            {/* Menu sélecteur pour les autres périodes */}
            <select
              aria-label="Autres périodes"
              value={showCustom ? "custom" : isQuickSelected ? "" : period}
              onChange={(e) => {
                const val = e.target.value as Period | "custom";
                if (!val) return;
                update({
                  periode: PERIOD_URL[val],
                  ...(val === "custom" ? {} : { du: undefined, au: undefined }),
                });
              }}
              className={`h-8 rounded-lg border px-2 text-xs font-medium outline-none transition-all ${
                !isQuickSelected || showCustom
                  ? "border-accent bg-accent/10 text-accent font-semibold"
                  : "border-border bg-surface-2/70 text-muted hover:text-foreground"
              }`}
            >
              <option value="" disabled>
                Plus de périodes...
              </option>
              {otherPeriods.map((p) => (
                <option key={p} value={p}>
                  {L.periods[p]}
                </option>
              ))}
            </select>
          </div>

          {/* Groupe Sélecteur de site */}
          {sites.length > 1 || !restricted ? (
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-semibold text-muted">
                <Building2 size={14} />
                <span>{L.siteLabel} :</span>
              </span>
              <select
                aria-label={L.siteLabel}
                value={siteId ?? ""}
                onChange={(e) => update({ site: e.target.value || undefined })}
                className="h-8 rounded-lg border border-border bg-surface-2/70 px-2.5 text-xs font-medium text-foreground outline-none transition-all hover:bg-surface-2"
              >
                {!restricted && <option value="">{L.allSites}</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        {/* Formulaire de période personnalisée */}
        {showCustom && (
          <form
            className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (ISO_DAY.test(draft.from) && ISO_DAY.test(draft.to) && draft.from <= draft.to) {
                update({ du: draft.from, au: draft.to });
              }
            }}
          >
            <span className="text-xs font-medium text-muted">Intervalle précis :</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
                aria-label={L.customFrom}
              />
              <span className="text-xs text-muted">au</span>
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
                aria-label={L.customTo}
              />
            </div>
            <Button type="submit" variant="primary" size="sm">
              {L.customApply}
            </Button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                update({ periode: PERIOD_URL.month, du: undefined, au: undefined });
              }}
              className="inline-flex h-8 items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <X size={12} />
              <span>Annuler</span>
            </button>
          </form>
        )}
      </div>

      {/* Barre d'onglets de vue avec icônes Lucide */}
      {tabs.length > 1 && (
        <div role="tablist" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 text-sm">
          {tabs.map((t) => {
            const active = t === tab;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={active}
                onClick={() => update({ onglet: TAB_URL[t] })}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-medium transition-all ${
                  active
                    ? "bg-accent text-accent-fg font-semibold shadow-sm"
                    : "border border-border/70 bg-surface text-muted hover:border-border hover:bg-surface-2/60 hover:text-foreground"
                }`}
              >
                {TAB_ICONS[t]}
                <span>{L.tabs[t]}</span>
              </button>
            );
          })}
        </div>
      )}

      {tab === "summary" && <SummaryTab input={input} />}
      {tab === "workshop" && <WorkshopTab input={input} timeZone={timeZone} />}
      {tab === "frontDesk" && <FrontDeskTab input={input} />}
      {tab === "reminders" && <RemindersTab input={input} />}
      {tab === "finances" && <FinancesTab input={input} timeZone={timeZone} />}
      {tab === "customers" && <CustomersTab input={input} />}
      {tab === "cashier" && <CashierCard timeZone={timeZone} />}

      <AlertsBlock />
      <AssistantFab />
    </div>
  );
}

// ─── Onglet Synthèse (gestion complète ou version AutoRappel) ─────────────────

function SummaryTab({ input }: { input: TabInput }) {
  const q = trpc.dashboard.overview.useQuery(input);
  if (q.isLoading) return <CardsSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const d = q.data;
  if (d.sales) {
    return (
      <div className="flex flex-col gap-4">
        <SummaryFull data={d} />
        {d.topUnpaid.length > 0 && <TopUnpaid entries={d.topUnpaid} />}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d.hasInvoices ? (
          <ReceivablesCard receivables={d.receivables} />
        ) : (
          <KpiCard
            label={L.cards.receivables}
            value={L.dash}
            help={L.help.receivables}
            icon={<CircleDollarSign size={16} strokeWidth={2.2} />}
          />
        )}
        <KpiCard
          label={L.cards.recovered}
          value={formatAmount(d.recovered.value)}
          variation={d.recovered.variation}
          help={L.help.recovered}
          icon={<Sparkles size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.cards.toHandleToday}
          value={String(d.remindersToHandleToday)}
          href="/relances"
          icon={<BellRing size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.cards.remindersSent}
          value={String(d.reminders.sent)}
          variation={d.reminders.sentVariation}
          sub={`${L.cards.returnedCustomers} : ${d.reminders.returnedCustomers}`}
          icon={<Send size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.cards.inspectionsDue30}
          value={d.inspectionsDue30 === null ? L.dash : String(d.inspectionsDue30)}
          help={d.inspectionsDue30 === null ? L.cards.notAttributable : undefined}
          href="/relances/echeances"
          icon={<CalendarClock size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.cards.servicesDueThisMonth}
          value={d.servicesDueThisMonth === null ? L.dash : String(d.servicesDueThisMonth)}
          help={d.servicesDueThisMonth === null ? L.cards.notAttributable : undefined}
          href="/relances/echeances"
          icon={<Wrench size={16} strokeWidth={2.2} />}
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
        <KpiCard
          label={L.reminders.sent}
          value={String(d.sent)}
          variation={d.sentVariation}
          icon={<Send size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.reminders.recovered}
          value={formatAmount(d.recoveredAmount)}
          variation={d.recoveredVariation}
          help={L.help.recovered}
          icon={<Sparkles size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.cards.returnedCustomers}
          value={String(d.returnedCustomers)}
          icon={<Users size={16} strokeWidth={2.2} />}
        />
        <KpiCard
          label={L.reminders.toApprove}
          value={String(d.toApprove)}
          href="/relances"
          icon={<BellRing size={16} strokeWidth={2.2} />}
        />
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

function FinancesTab({ input, timeZone }: { input: TabInput; timeZone: string }) {
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
      <Section title={L.finances.byMethod}>
        {Object.keys(d.collected.byMethod).length === 0 ? (
          <p className="text-sm text-muted">{L.states.empty}</p>
        ) : (
          <BarList
            items={Object.entries(d.collected.byMethod)
              .sort((a, b) => b[1] - a[1])
              .map(([method, amount]) => ({
                key: method,
                label: methodLabel(method),
                value: amount,
              }))}
          />
        )}
      </Section>
      <Section title={L.finances.fneFailed}>
        {d.fneFailed.count === 0 ? (
          <p className="text-sm text-muted">{L.finances.noFneFailed}</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.fneFailed.invoices.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/factures/${i.id}`}
                  className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm hover:underline"
                >
                  <span className="min-w-0">
                    <StatusBadge tone="bad">{i.number ?? L.dash}</StatusBadge>
                    <span className="block truncate text-xs text-muted">
                      {formatDateTime(i.issuedAt, timeZone)} · {i.fneError ?? ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium">{formatAmount(i.total)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {d.promisesToday && (
        <Section title={L.finances.promisesToday}>
          {d.promisesToday.length === 0 ? (
            <p className="text-sm text-muted">{L.finances.noPromises}</p>
          ) : (
            <ul className="divide-y divide-border">
              {d.promisesToday.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/creances/${p.caseId}`}
                    className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm hover:underline"
                  >
                    <span className="truncate">{p.customerName}</span>
                    <span className="shrink-0 font-medium">{formatAmount(p.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
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
