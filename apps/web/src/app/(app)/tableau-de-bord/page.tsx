"use client";

// M12 §7 — `/tableau-de-bord` : onglets selon le rôle et les permissions (Aujourd'hui, Synthèse, Atelier,
// Accueil, Finances, Relances, Clients ; CASHIER : « Ma caisse du jour »), version AutoRappel
// en mode REMINDERS_ONLY (US-M12-10), bloc Alertes (RG-M12-28). Période (dont personnalisée)
// et site dans l'URL (`?periode=mois&site=…`, US-M12-02).
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, EmptyState, StatusBadge, type StatusTone } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AssistantFab } from "@/components/assistant-fab";
import type { AppRouter } from "@/server/routers/_app";
import { fmt, formatAmount, formatDay, L, methodLabel, reminderTypeLabel } from "./labels";
import {
  BarList,
  CardsSkeleton,
  EmptyLine,
  ErrorState,
  formatDateTime,
  KpiCard,
  ListRow,
  Section,
  Stat,
} from "./parts";
import {
  CashierCard,
  CustomersTab,
  FrontDeskTab,
  PERIODS,
  ReceivablesCard,
  SummaryFull,
  WorkshopTab,
  type Period,
  type TabInput,
} from "./tabs";
import { TodayTab } from "./today";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Tab =
  | "today"
  | "summary"
  | "workshop"
  | "frontDesk"
  | "finances"
  | "reminders"
  | "customers"
  | "cashier";

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
  today: "aujourdhui",
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
  OWNER: "today",
  MANAGER: "today",
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
  const me = trpc.me.get.useQuery();

  const permissions = new Set(me.data?.permissions ?? []);
  const role = me.data?.membership?.role ?? "";
  const mode = me.data?.activeOrganization?.operatingMode ?? "FULL";
  const timeZone = me.data?.activeOrganization?.timezone ?? "Africa/Abidjan";
  const full = mode === "FULL";
  const tabs: Tab[] = [];
  // M12 §10 : MECHANIC sans accès (redirigé vers la tablette).
  if (role !== "MECHANIC") {
    // Vue du jour de l'atelier : gestion complète, propriétaire ou chef d'atelier.
    if (full && (permissions.has("dashboard:owner") || permissions.has("repair_order:read"))) {
      tabs.push("today");
    }
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
  // L'onglet « Aujourd'hui » porte sur le jour même : pas de sélecteur de période.
  const showPeriod = tab !== "today";
  const showCustom = showPeriod && urlPeriod === "custom";

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
  const periodOptions: (Period | "custom")[] = [...PERIODS, "custom"];

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{L.title}</h1>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          {(permissions.has("report:read") || permissions.has("report:financial")) && (
            <Link href="/rapports" className="flex min-h-11 items-center text-sm underline">
              {L.reportsLink}
            </Link>
          )}
          {full && permissions.has("repair_order:create") && (
            <Link href="/ordres/reception" className="btn btn-primary min-h-11">
              + {L.today.newReception}
            </Link>
          )}
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-end gap-2 bg-background px-1 py-2">
        {showPeriod && (
          <label className="flex min-w-0 flex-1 flex-col text-xs text-muted sm:flex-none">
            {L.periodLabel}
            <select
              aria-label={L.periodLabel}
              value={showCustom ? "custom" : period}
              onChange={(e) => {
                const value = e.target.value as Period | "custom";
                update({
                  periode: PERIOD_URL[value],
                  ...(value === "custom" ? {} : { du: undefined, au: undefined }),
                });
              }}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            >
              {periodOptions.map((p) => (
                <option key={p} value={p}>
                  {L.periods[p]}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {showCustom && (
          <form
            className="flex w-full flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ISO_DAY.test(draft.from) && ISO_DAY.test(draft.to) && draft.from <= draft.to) {
                update({ du: draft.from, au: draft.to });
              }
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
              {L.customFrom}
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col text-xs text-muted">
              {L.customTo}
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground"
              />
            </label>
            <Button type="submit" variant="secondary">
              {L.customApply}
            </Button>
          </form>
        )}
      </div>

      {tabs.length > 1 && (
        <div
          role="tablist"
          className="-mx-1 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1 text-sm shadow-sm sm:mx-0 sm:w-fit"
        >
          {tabs.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={t === tab}
              onClick={() => update({ onglet: TAB_URL[t] })}
              className={`min-h-11 shrink-0 rounded-lg px-4 font-medium transition-colors ${t === tab ? "bg-accent text-accent-foreground shadow-sm" : "text-muted hover:bg-surface-2 hover:text-foreground"}`}
            >
              {L.tabs[t]}
            </button>
          ))}
        </div>
      )}

      {tab === "today" && <TodayTab input={input} timeZone={timeZone} />}
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
          <KpiCard label={L.cards.receivables} value={L.dash} help={L.help.receivables} />
        )}
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
            <ul className="mt-4 flex flex-wrap gap-2 text-xs">
              {Object.entries(d.sentByType).map(([type, count]) => (
                <li
                  key={type}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1 font-medium"
                >
                  {reminderTypeLabel(type)} · {count}
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
    <div className="rounded-lg bg-surface-2 p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">
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
  return (
    <BarList
      format={String}
      items={weeks.map((w) => ({
        key: w.weekStart,
        label: fmt(L.reminders.weekOf, { date: formatDay(w.weekStart) }),
        value: w.total,
      }))}
    />
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
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Section title={L.finances.aged}>
          <BarList
            items={bucketKeys.map((k) => ({
              key: k,
              label: L.finances.buckets[k],
              value: r.buckets[k],
            }))}
          />
        </Section>
        <Section title={L.finances.byMethod}>
          {Object.keys(d.collected.byMethod).length === 0 ? (
            <EmptyLine>{L.states.empty}</EmptyLine>
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
      </div>
      <Section title={L.finances.fneFailed}>
        {d.fneFailed.count === 0 ? (
          <EmptyLine>{L.finances.noFneFailed}</EmptyLine>
        ) : (
          <ul className="divide-y divide-border">
            {d.fneFailed.invoices.map((i) => (
              <ListRow
                key={i.id}
                href={`/factures/${i.id}`}
                title={<StatusBadge tone="bad">{i.number ?? L.dash}</StatusBadge>}
                sub={`${formatDateTime(i.issuedAt, timeZone)} · ${i.fneError ?? ""}`}
                right={<span className="font-medium">{formatAmount(i.total)}</span>}
              />
            ))}
          </ul>
        )}
      </Section>
      {d.promisesToday && (
        <Section title={L.finances.promisesToday}>
          {d.promisesToday.length === 0 ? (
            <EmptyLine>{L.finances.noPromises}</EmptyLine>
          ) : (
            <ul className="divide-y divide-border">
              {d.promisesToday.map((p) => (
                <ListRow
                  key={p.id}
                  href={`/creances/${p.caseId}`}
                  title={p.customerName}
                  right={<span className="font-medium">{formatAmount(p.amount)}</span>}
                />
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
          <ListRow
            key={e.customerId}
            href={`/clients/${e.customerId}`}
            title={e.customerName}
            sub={
              <span className="flex flex-wrap items-center gap-2">
                {fmt(L.finances.invoices, { count: e.invoiceCount })}
                {e.maxDaysLate > 0 ? (
                  <StatusBadge tone={e.maxDaysLate > 30 ? "bad" : "warn"}>
                    {fmt(L.finances.daysLate, { days: e.maxDaysLate })}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="off">{L.finances.notDue}</StatusBadge>
                )}
              </span>
            }
            right={<span className="font-semibold">{formatAmount(e.balance)}</span>}
          />
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
        <EmptyLine>{L.alerts.empty}</EmptyLine>
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
