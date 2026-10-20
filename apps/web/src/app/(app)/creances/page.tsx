"use client";

// PRD M09 §7.1 — /creances : vue moderne enrichie, KPIs de trésorerie,
// balance âgée interactive, onglets Dossiers / Factures, tableaux intelligents.
import { useCallback, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  MessageCircle,
  Phone,
  RotateCcw,
  Search,
  TrendingUp,
  User,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, StatusBadge } from "@atelieros/ui";
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

function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const clean = phone.replace(/\s+/g, "");
  if (clean.startsWith("+225") && clean.length === 14) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 6)} ${clean.slice(6, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)} ${clean.slice(12)}`;
  }
  return phone;
}

export default function CreancesPage() {
  const [view, setView] = useState<"customers" | "invoices">("customers");
  const [tab, setTab] = useState<Tab>("ALL");
  const [bucket, setBucket] = useState<Bucket | undefined>(undefined);
  const [search, setSearch] = useState("");

  const summary = trpc.collections.agingSummary.useQuery({});

  const hasFilter = Boolean(bucket || search.trim() || tab !== "ALL");

  const clearAllFilters = useCallback(() => {
    setBucket(undefined);
    setSearch("");
    setTab("ALL");
  }, []);

  return (
    <div className="flex flex-col gap-6 pb-16">
      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Wallet size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
              {summary.data && (
                <span className="rounded-full bg-status-bad-bg px-2.5 py-0.5 text-xs font-semibold text-status-bad">
                  {formatFCFA(summary.data.total - summary.data.notDue)} en retard
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Suivi du recouvrement, balance âgée, promesses de paiement et relances automatiques
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/relances/echeances"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Clock size={14} className="text-muted" />
            <span>Échéancier des relances</span>
          </Link>
          <Link
            href="/parametres/relances"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <span>Règles d&apos;automatisation</span>
          </Link>
        </div>
      </div>

      {summary.data?.importedBalancesAt && (
        <div className="flex items-center gap-2 rounded-xl border border-status-warn/40 bg-status-warn-bg p-3 text-xs text-status-warn">
          <AlertTriangle size={15} className="shrink-0" />
          <span>{t("importedBalances", { date: formatDay(new Date(summary.data.importedBalancesAt)) })}</span>
        </div>
      )}

      {/* Cartes KPI intelligentes */}
      {summary.isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2/60" />
          ))}
        </div>
      )}
      {summary.isError && <ErrorBox onRetry={() => summary.refetch()} />}

      {summary.data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{t("kpi.totalDue")}</span>
                <Wallet size={16} className="text-muted" />
              </div>
              <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
                {formatFCFA(summary.data.total)}
              </div>
              <div className="mt-1 text-[11px] text-muted">Total des créances ouvertes</div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{t("kpi.overdue")}</span>
                <AlertCircle size={16} className="text-status-bad" />
              </div>
              <div className="mt-2 text-xl font-bold tracking-tight text-status-bad">
                {formatFCFA(summary.data.total - summary.data.notDue)}
              </div>
              <div className="mt-1 text-[11px] text-status-bad font-medium">
                {t("kpi.over30", {
                  amount: formatFCFA(
                    summary.data.buckets.b31_60 +
                      summary.data.buckets.b61_90 +
                      summary.data.buckets.b90p,
                  ),
                })}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{t("kpi.recovered")}</span>
                <TrendingUp size={16} className="text-status-ok" />
              </div>
              <div className="mt-2 text-xl font-bold tracking-tight text-status-ok">
                {formatFCFA(summary.data.recoveredThisMonth.total)}
              </div>
              <div className="mt-1 text-[11px] text-muted">
                {t("kpi.recoveredByReminders", {
                  amount: formatFCFA(summary.data.recoveredThisMonth.reminders),
                })}
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{t("kpi.unallocated")}</span>
                <CheckCircle2 size={16} className="text-muted" />
              </div>
              <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
                {formatFCFA(summary.data.unallocatedCredits)}
              </div>
              <div className="mt-1 text-[11px] text-muted">Acomptes & crédits en attente</div>
            </div>
          </div>

          {/* Balance âgée interactive */}
          <section className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">
                  {t("aging.title")}
                </h2>
                <span className="text-xs text-muted">— Répartition par retard d&apos;échéance</span>
              </div>
              {bucket && (
                <button
                  type="button"
                  onClick={() => setBucket(undefined)}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-muted hover:text-foreground"
                >
                  <RotateCcw size={11} />
                  <span>{t("aging.clearFilter")}</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {BUCKETS.map((b) => {
                const amount = b === "notDue" ? summary.data.notDue : summary.data.buckets[b];
                const pct =
                  summary.data.total > 0 ? Math.round((amount * 100) / summary.data.total) : 0;
                const isSelected = bucket === b;

                const colorClass =
                  b === "notDue"
                    ? "bg-status-ok"
                    : b === "b0_30"
                      ? "bg-status-warn"
                      : "bg-status-bad";

                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBucket(bucket === b ? undefined : b)}
                    aria-pressed={isSelected}
                    className={`flex flex-col justify-between gap-2 rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-accent bg-accent/5 ring-2 ring-accent shadow-xs"
                        : "border-border/80 bg-surface hover:border-border hover:bg-surface-2/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground">
                        {t(`aging.${b}`)}
                      </span>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        {pct}%
                      </span>
                    </div>

                    <div>
                      <div className="text-sm font-bold text-foreground">
                        {formatFCFA(amount)}
                      </div>
                      <div className="text-[11px] text-muted">
                        {t("aging.customers", { count: summary.data.customersByBucket[b] })}
                      </div>
                    </div>

                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full transition-all ${colorClass}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* Barre d'outils : Vues & Filtres */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Commutateur de vue : Par client vs Par facture */}
        <div className="flex items-center rounded-xl border border-border/80 bg-surface p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setView("customers")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              view === "customers"
                ? "bg-accent text-accent-foreground shadow-xs"
                : "text-muted hover:text-foreground hover:bg-surface-2"
            }`}
          >
            <Users size={13} />
            <span>{t("views.byCustomer")}</span>
          </button>
          <button
            type="button"
            onClick={() => setView("invoices")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              view === "invoices"
                ? "bg-accent text-accent-foreground shadow-xs"
                : "text-muted hover:text-foreground hover:bg-surface-2"
            }`}
          >
            <Clock size={13} />
            <span>{t("views.byInvoice")}</span>
          </button>
        </div>

        {/* Barre de recherche avec filtre rapide de tranche */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filtre tranche de retard */}
          <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-0.5">
            <button
              type="button"
              onClick={() => setBucket(undefined)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                !bucket ? "bg-accent text-accent-foreground shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              {t("bucketFilter.all")}
            </button>
            <button
              type="button"
              onClick={() => setBucket(bucket === "b0_30" ? undefined : "b0_30")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                bucket === "b0_30" ? "bg-accent text-accent-foreground shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              {t("bucketFilter.b0_30")}
            </button>
            <button
              type="button"
              onClick={() => setBucket(bucket === "b31_60" ? undefined : "b31_60")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                bucket === "b31_60" ? "bg-accent text-accent-foreground shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              {t("bucketFilter.b31_60")}
            </button>
            <button
              type="button"
              onClick={() => setBucket(bucket === "b90p" ? undefined : "b90p")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                bucket === "b90p" ? "bg-status-bad text-white shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              {t("bucketFilter.over60")}
            </button>
          </div>

          {/* Barre de recherche si vue client */}
          {view === "customers" && (
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {view === "customers" ? (
        <>
          {/* Onglets de statuts des dossiers */}
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/80 bg-surface p-1 shadow-xs">
            {TABS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  tab === value
                    ? "bg-accent text-accent-foreground shadow-xs"
                    : "text-muted hover:text-foreground hover:bg-surface-2"
                }`}
              >
                {t(`tabs.${value}`)}
              </button>
            ))}
          </div>

          <CasesList
            tab={tab}
            bucket={bucket}
            search={search.trim() || undefined}
            onResetFilters={clearAllFilters}
            hasFilter={hasFilter}
          />
        </>
      ) : (
        <InvoicesList bucket={bucket} onResetFilter={() => setBucket(undefined)} />
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl bg-surface-2/60" />
      ))}
    </div>
  );
}

function CasesList({
  tab,
  bucket,
  search,
  onResetFilters,
  hasFilter,
}: {
  tab: Tab;
  bucket?: Bucket;
  search?: string;
  onResetFilters: () => void;
  hasFilter: boolean;
}) {
  const query = trpc.collections.listCases.useInfiniteQuery(
    { tab, bucket, search, limit: 25 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center">
        <Wallet size={36} className="text-muted/60" />
        <h3 className="mt-3 text-sm font-semibold text-foreground">
          {hasFilter ? t("emptyFiltered") : t("empty")}
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted">
          {hasFilter ? t("emptyFilteredDescription") : t("emptyDescription")}
        </p>
        {hasFilter && (
          <button
            type="button"
            onClick={onResetFilters}
            className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            {t("filterReset")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="py-3.5 pl-4 pr-3">Client</th>
                <th className="px-3 py-3.5">Risque & Contact</th>
                <th className="px-3 py-3.5 text-right">Solde dû</th>
                <th className="px-3 py-3.5 text-right">En retard</th>
                <th className="px-3 py-3.5 text-center">Retard max</th>
                <th className="px-3 py-3.5">Statut & Promesses</th>
                <th className="py-3.5 pl-3 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((c) => {
                const risk = riskLabelOf(c.customer.riskScore);
                const isOver60 = c.maxDaysOverdue > 60;

                return (
                  <tr
                    key={c.id}
                    className="group transition-colors hover:bg-surface-2/40"
                  >
                    {/* Client */}
                    <td className="py-3.5 pl-4 pr-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xs font-bold text-foreground">
                          {c.customer.type === "COMPANY" ? (
                            <Building2 size={16} className="text-muted" />
                          ) : (
                            <User size={16} className="text-muted" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/creances/${c.id}`}
                            className="font-semibold text-foreground group-hover:text-accent group-hover:underline"
                          >
                            {c.customer.displayName}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span>{t(`customerType.${c.customer.type}`)}</span>
                            {c.customer.phone && (
                              <>
                                <span>•</span>
                                <a
                                  href={`tel:${c.customer.phone}`}
                                  className="hover:text-foreground"
                                >
                                  {formatPhone(c.customer.phone)}
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Risque & Alertes */}
                    <td className="px-3 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={risk.tone}>
                          {t(risk.key)}
                          {c.customer.riskScore !== null ? ` (${c.customer.riskScore})` : ""}
                        </StatusBadge>
                        {c.unreachable && (
                          <StatusBadge tone="bad">{t("unreachable")}</StatusBadge>
                        )}
                        {c.customer.creditHold && (
                          <StatusBadge tone="bad">{t("creditHold")}</StatusBadge>
                        )}
                      </div>
                    </td>

                    {/* Solde dû */}
                    <td className="px-3 py-3.5 text-right font-medium tabular-nums text-foreground">
                      {formatFCFA(c.totalDue)}
                    </td>

                    {/* En retard */}
                    <td className="px-3 py-3.5 text-right tabular-nums">
                      <span className="font-bold text-status-bad">
                        {formatFCFA(c.overdueDue)}
                      </span>
                    </td>

                    {/* Retard max */}
                    <td className="px-3 py-3.5 text-center">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          isOver60
                            ? "bg-status-bad-bg text-status-bad"
                            : c.maxDaysOverdue > 30
                              ? "bg-status-warn-bg text-status-warn"
                              : "text-muted"
                        }`}
                      >
                        {t("days", { count: c.maxDaysOverdue })}
                      </span>
                    </td>

                    {/* Statut & Promesses */}
                    <td className="px-3 py-3.5">
                      <div className="flex flex-col gap-1 text-xs">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge tone={CASE_STATUS_TONE[c.status] ?? "off"}>
                            {t(`caseStatus.${c.status}`)}
                          </StatusBadge>
                        </div>
                        {c.nextPromise && (
                          <span className="text-[11px] font-medium text-status-ok">
                            {t("promiseNext", {
                              amount: formatFCFA(c.nextPromise.amount),
                              date: formatDay(c.nextPromise.promisedDate),
                            })}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 pl-3 pr-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.customer.phone && (
                          <>
                            <a
                              href={`tel:${c.customer.phone}`}
                              title={t("quickActions.call")}
                              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
                            >
                              <Phone size={13} />
                            </a>
                            <a
                              href={`https://wa.me/${c.customer.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                                t("quickActions.whatsappMessage", {
                                  name: c.customer.displayName,
                                  amount: formatFCFA(c.overdueDue),
                                }),
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t("quickActions.whatsapp")}
                              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-status-ok"
                            >
                              <MessageCircle size={14} />
                            </a>
                          </>
                        )}
                        <Link
                          href={`/creances/${c.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                        >
                          <span>{t("quickActions.viewAccount")}</span>
                          <ArrowRight size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function InvoicesList({
  bucket,
  onResetFilter,
}: {
  bucket?: Bucket;
  onResetFilter: () => void;
}) {
  const query = trpc.collections.listInvoices.useInfiniteQuery(
    { bucket, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border p-12 text-center">
        <Clock size={36} className="text-muted/60" />
        <h3 className="mt-3 text-sm font-semibold text-foreground">{t("empty")}</h3>
        <p className="mt-1 max-w-sm text-xs text-muted">{t("emptyDescription")}</p>
        {bucket && (
          <button
            type="button"
            onClick={onResetFilter}
            className="mt-3 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            Retirer le filtre de tranche
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="py-3.5 pl-4 pr-3">{t("columns.number")}</th>
                <th className="px-3 py-3.5">{t("columns.customer")}</th>
                <th className="px-3 py-3.5">{t("columns.dueDate")}</th>
                <th className="px-3 py-3.5 text-center">{t("columns.days")}</th>
                <th className="px-3 py-3.5 text-right">{t("columns.total")}</th>
                <th className="px-3 py-3.5 text-right">{t("columns.balance")}</th>
                <th className="px-3 py-3.5 text-center">{t("columns.status")}</th>
                <th className="py-3.5 pl-3 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {items.map((i) => {
                const isOverdue = i.daysOverdue > 0;

                return (
                  <tr
                    key={i.id}
                    className="group transition-colors hover:bg-surface-2/40"
                  >
                    {/* Numéro facture */}
                    <td className="py-3.5 pl-4 pr-3">
                      <Link
                        href={`/factures/${i.id}`}
                        className="font-mono font-semibold text-foreground group-hover:text-accent group-hover:underline"
                      >
                        {i.number ?? "—"}
                      </Link>
                    </td>

                    {/* Client */}
                    <td className="px-3 py-3.5">
                      <Link
                        href={`/clients/${i.customer.id}`}
                        className="font-medium text-foreground hover:text-accent hover:underline"
                      >
                        {i.customer.displayName}
                      </Link>
                    </td>

                    {/* Échéance */}
                    <td className="px-3 py-3.5 text-xs">
                      <span className={isOverdue ? "font-semibold text-status-bad" : "text-muted"}>
                        {formatDay(i.dueDate)}
                      </span>
                    </td>

                    {/* Retard en jours */}
                    <td className="px-3 py-3.5 text-center">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          i.daysOverdue > 60
                            ? "bg-status-bad-bg text-status-bad"
                            : i.daysOverdue > 30
                              ? "bg-status-warn-bg text-status-warn"
                              : isOverdue
                                ? "text-status-warn"
                                : "text-muted"
                        }`}
                      >
                        {i.daysOverdue > 0 ? `+${i.daysOverdue} j` : "À jour"}
                      </span>
                    </td>

                    {/* Total */}
                    <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                      {formatFCFA(i.total)}
                    </td>

                    {/* Solde restant dû */}
                    <td className="px-3 py-3.5 text-right font-bold tabular-nums text-status-bad">
                      {formatFCFA(i.balance)}
                    </td>

                    {/* Statut */}
                    <td className="px-3 py-3.5 text-center">
                      <div className="flex justify-center">
                        <StatusBadge tone={INVOICE_STATUS_TONE[i.status] ?? "off"}>
                          {t(`invoiceStatus.${i.status}`)}
                        </StatusBadge>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="py-3.5 pl-3 pr-4 text-right">
                      <Link
                        href={`/factures/${i.id}`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-2 hover:border-accent"
                      >
                        <span>Voir</span>
                        <ExternalLink size={12} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
