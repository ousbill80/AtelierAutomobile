"use client";

// PRD M09 §7.1 — /creances : KPI, balance âgée cliquable, onglets par client / par facture.
// Écarts documentés : pas de DSO ni d'export Excel, pas de filtres site/assigné/score.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox } from "./error-box";
import {
  BUCKETS,
  CASE_STATUS_TONE,
  INVOICE_STATUS_TONE,
  formatDay,
  riskLabelOf,
  t,
  type Bucket,
} from "./i18n";

const TABS = ["ALL", "TO_HANDLE", "PROMISES", "DISPUTES", "WRITTEN_OFF"] as const;
type Tab = (typeof TABS)[number];

export default function CreancesPage() {
  const [view, setView] = useState<"customers" | "invoices">("customers");
  const [tab, setTab] = useState<Tab>("ALL");
  const [bucket, setBucket] = useState<Bucket | undefined>(undefined);
  const [search, setSearch] = useState("");

  const summary = trpc.collections.agingSummary.useQuery({});

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {summary.data?.importedBalancesAt && (
        <p className="rounded-md border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn">
          {t("importedBalances", { date: formatDay(new Date(summary.data.importedBalancesAt)) })}
        </p>
      )}

      {summary.isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}
      {summary.isError && <ErrorBox onRetry={() => summary.refetch()} />}

      {summary.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label={t("kpi.totalDue")} value={formatFCFA(summary.data.total)} />
            <Kpi
              label={t("kpi.overdue")}
              value={formatFCFA(summary.data.total - summary.data.notDue)}
              hint={t("kpi.over30", {
                amount: formatFCFA(
                  summary.data.buckets.b31_60 +
                    summary.data.buckets.b61_90 +
                    summary.data.buckets.b90p,
                ),
              })}
            />
            <Kpi
              label={t("kpi.recovered")}
              value={formatFCFA(summary.data.recoveredThisMonth.total)}
              hint={t("kpi.recoveredByReminders", {
                amount: formatFCFA(summary.data.recoveredThisMonth.reminders),
              })}
            />
            <Kpi label={t("kpi.unallocated")} value={formatFCFA(summary.data.unallocatedCredits)} />
          </div>

          <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t("aging.title")}</h2>
              {bucket && (
                <Button variant="ghost" onClick={() => setBucket(undefined)}>
                  {t("aging.clearFilter")}
                </Button>
              )}
            </div>
            {BUCKETS.map((b) => {
              const amount = b === "notDue" ? summary.data.notDue : summary.data.buckets[b];
              const pct =
                summary.data.total > 0 ? Math.round((amount * 100) / summary.data.total) : 0;
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBucket(bucket === b ? undefined : b)}
                  aria-pressed={bucket === b}
                  className={`flex min-h-11 flex-col gap-1 rounded-md px-2 py-1 text-left hover:bg-surface-2 ${bucket === b ? "ring-2 ring-accent" : ""}`}
                >
                  <span className="flex w-full justify-between text-sm">
                    <span className="font-medium">{t(`aging.${b}`)}</span>
                    <span>
                      {formatFCFA(amount)} ·{" "}
                      <span className="text-muted">
                        {t("aging.customers", { count: summary.data.customersByBucket[b] })}
                      </span>
                    </span>
                  </span>
                  <span className="h-2 w-full rounded bg-surface-2">
                    <span
                      className={`block h-2 rounded ${b === "notDue" ? "bg-status-ok" : b === "b0_30" ? "bg-status-warn" : "bg-status-bad"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </section>
        </>
      )}

      <div className="flex flex-wrap gap-2 text-sm">
        {(["customers", "invoices"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`min-h-11 rounded-md px-3 ${view === v ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {t(v === "customers" ? "views.byCustomer" : "views.byInvoice")}
          </button>
        ))}
      </div>

      {view === "customers" ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            {TABS.map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`min-h-11 rounded-md border border-border px-3 ${tab === value ? "bg-surface-2 font-semibold" : "bg-surface"}`}
              >
                {t(`tabs.${value}`)}
              </button>
            ))}
          </div>
          <input
            className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
            placeholder={t("search")}
            aria-label={t("search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CasesList tab={tab} bucket={bucket} search={search.trim() || undefined} />
        </>
      ) : (
        <InvoicesList bucket={bucket} />
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  );
}

function CasesList({ tab, bucket, search }: { tab: Tab; bucket?: Bucket; search?: string }) {
  const query = trpc.collections.listCases.useInfiniteQuery(
    { tab, bucket, search, limit: 25 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return <EmptyState title={t("empty")} description={t("emptyDescription")} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((c) => {
        const risk = riskLabelOf(c.customer.riskScore);
        return (
          <Link
            key={c.id}
            href={`/creances/${c.id}`}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 hover:bg-surface-2 md:flex-row md:items-center md:justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{c.customer.displayName}</span>
              <span className="flex flex-wrap gap-1.5">
                <StatusBadge tone="off">{t(`customerType.${c.customer.type}`)}</StatusBadge>
                <StatusBadge tone={CASE_STATUS_TONE[c.status] ?? "off"}>
                  {t(`caseStatus.${c.status}`)}
                </StatusBadge>
                <StatusBadge tone={risk.tone}>
                  {t(risk.key)}
                  {c.customer.riskScore !== null ? ` (${c.customer.riskScore})` : ""}
                </StatusBadge>
                {c.unreachable && <StatusBadge tone="bad">{t("unreachable")}</StatusBadge>}
                {c.customer.creditHold && <StatusBadge tone="bad">{t("creditHold")}</StatusBadge>}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm md:text-right">
              <span>
                <span className="block text-xs text-muted">{t("columns.totalDue")}</span>
                {formatFCFA(c.totalDue)}
              </span>
              <span>
                <span className="block text-xs text-muted">{t("columns.overdue")}</span>
                {formatFCFA(c.overdueDue)}
              </span>
              <span>
                <span className="block text-xs text-muted">{t("columns.maxDays")}</span>
                {t("days", { count: c.maxDaysOverdue })}
              </span>
            </div>
            {c.nextPromise && (
              <span className="text-xs text-muted">
                {t("promiseNext", {
                  amount: formatFCFA(c.nextPromise.amount),
                  date: formatDay(c.nextPromise.promisedDate),
                })}
              </span>
            )}
          </Link>
        );
      })}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}

function InvoicesList({ bucket }: { bucket?: Bucket }) {
  const query = trpc.collections.listInvoices.useInfiniteQuery(
    { bucket, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) {
    return <EmptyState title={t("empty")} description={t("emptyDescription")} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => (
        <div
          key={i.id}
          className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="font-medium">
              {i.number ?? "—"} · {i.customer.displayName}
            </span>
            <span className="flex flex-wrap gap-1.5 text-xs text-muted">
              <StatusBadge tone={INVOICE_STATUS_TONE[i.status] ?? "off"}>
                {t(`invoiceStatus.${i.status}`)}
              </StatusBadge>
              <span>
                {t("columns.dueDate")} : {formatDay(i.dueDate)}
              </span>
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm md:text-right">
            <span>
              <span className="block text-xs text-muted">{t("columns.total")}</span>
              {formatFCFA(i.total)}
            </span>
            <span>
              <span className="block text-xs text-muted">{t("columns.balance")}</span>
              {formatFCFA(i.balance)}
            </span>
            <span>
              <span className="block text-xs text-muted">{t("columns.days")}</span>
              {i.daysOverdue}
            </span>
          </div>
        </div>
      ))}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
