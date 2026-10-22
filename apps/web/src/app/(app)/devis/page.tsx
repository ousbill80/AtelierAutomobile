"use client";

// M05 §7 — /devis : indicateurs opérationnels interactifs (KPIs), recherche intelligente
// instantanée, onglets enrichis avec compteurs en temps réel, DataTable responsive et actions rapides.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  RotateCcw,
  Search,
  TrendingUp,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DataTable,
  type DataTableColumn,
  PlateBadge,
  Select,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { QuoteStatusBadge } from "@/components/quotes/badges";
import { t } from "@/components/quotes/i18n";
import { QuoteStats } from "./stats";

const TABS = ["all", "todo", "waiting", "decided", "expired", "stats"] as const;
type Tab = (typeof TABS)[number];

export default function QuotesPage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const perms = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);

  const list = trpc.quote.list.useQuery(
    {
      tab: tab === "stats" ? "all" : tab,
      q: q.trim() || undefined,
      origin: (origin || undefined) as "STANDALONE" | undefined,
    },
    { enabled: tab !== "stats", refetchInterval: 30_000 },
  );

  const counts = list.data?.counts;
  const kpis = list.data?.kpis;
  const items = useMemo(() => list.data?.items ?? [], [list.data?.items]);
  const timeZone = list.data?.timeZone;

  const totalQuotesCount = useMemo(() => {
    if (kpis?.totalCount !== undefined) return kpis.totalCount;
    if (!counts) return 0;
    return (counts.todo ?? 0) + (counts.waiting ?? 0) + (counts.decided ?? 0) + (counts.expired ?? 0);
  }, [kpis?.totalCount, counts]);

  const hasActiveFilters = Boolean(q.trim() || origin || tab !== "all");

  const resetFilters = useCallback(() => {
    setQ("");
    setOrigin("");
    setTab("all");
  }, []);

  type QuoteItem = (typeof items)[number];

  const columns: DataTableColumn<QuoteItem>[] = useMemo(
    () => [
      {
        key: "number",
        header: t("columns.number"),
        primary: true,
        render: (quote) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-semibold text-foreground">
                {quote.number}
                {quote.version > 1 ? ` v${quote.version}` : ""}
              </span>
              {quote.discountApprovalStatus === "PENDING" && (
                <span className="rounded bg-status-warn-bg px-1 py-0.2 text-[10px] font-bold text-status-warn">
                  ⚠ {t("discount.pendingShort")}
                </span>
              )}
            </div>
            <span className="text-xs text-muted">
              {formatDay(quote.createdAt, timeZone)}
            </span>
          </div>
        ),
      },
      {
        key: "customerVehicle",
        header: t("columns.customerVehicle"),
        render: (quote) => (
          <div className="flex flex-col gap-1">
            <span className="truncate text-sm font-medium text-foreground">
              {quote.customer.displayName}
            </span>
            {quote.vehicle ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <PlateBadge plate={quote.vehicle.plate} />
                <span className="text-xs text-muted">
                  {quote.vehicle.make} {quote.vehicle.model}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted">—</span>
            )}
          </div>
        ),
      },
      {
        key: "origin",
        header: t("columns.origin"),
        render: (quote) => (
          <div className="flex flex-col">
            <span className="inline-flex w-fit items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
              {t(`origin.${quote.origin}`)}
            </span>
            {quote.advisor && (
              <span className="mt-0.5 text-xs text-muted">
                {quote.advisor}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "status",
        header: t("columns.status"),
        render: (quote) => (
          <div className="flex flex-col gap-1">
            <QuoteStatusBadge status={quote.status} />
          </div>
        ),
      },
      {
        key: "dates",
        header: t("columns.dates"),
        render: (quote) => {
          const isExpiringSoon = quote.daysToExpiry >= 0 && quote.daysToExpiry <= 3;
          const isExpired = quote.daysToExpiry < 0 || quote.status === "EXPIRED";
          return (
            <div className="flex flex-col text-xs">
              <span className="text-muted">
                {t("validUntil", { date: formatDay(quote.validUntil, timeZone) })}
              </span>
              {(quote.status === "SENT" || quote.status === "VIEWED" || quote.status === "DRAFT") && (
                <span
                  className={`font-medium ${
                    isExpired
                      ? "text-status-bad"
                      : isExpiringSoon
                        ? "text-status-warn font-semibold"
                        : "text-muted"
                  }`}
                >
                  {quote.daysToExpiry >= 0
                    ? t("list.expiresIn", { days: quote.daysToExpiry })
                    : t("status.EXPIRED")}
                </span>
              )}
            </div>
          );
        },
      },
      {
        key: "amount",
        header: t("columns.amount"),
        render: (quote) => (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-foreground">
              {formatFCFA(quote.total)}
            </span>
            {quote.acceptedTotal > 0 && quote.acceptedTotal !== quote.total && (
              <span className="text-xs text-status-ok">
                {t("list.accepted", { amount: formatFCFA(quote.acceptedTotal) })}
              </span>
            )}
          </div>
        ),
      },
      {
        key: "tracking",
        header: t("columns.tracking"),
        render: (quote) => (
          <div className="flex flex-col text-xs text-muted">
            <span className="flex items-center gap-1">
              <Eye className="size-3" aria-hidden />
              <span>{quote.viewedAt ? t("list.viewed") : t("list.notViewed")}</span>
            </span>
            <span>{t("list.followups", { count: quote.followupsSent })}</span>
          </div>
        ),
      },
      {
        key: "actions",
        header: t("columns.actions"),
        render: (quote) => (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <a
              href={`/api/devis/${quote.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              title={t("actions.pdf")}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              <Download className="size-4" aria-hidden />
            </a>
            <Link
              href={`/devis/${quote.id}`}
              title={t("actions.view")}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        ),
      },
    ],
    [timeZone],
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* En-tête de page */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="text-xs text-muted sm:text-sm">{t("description")}</p>
        </div>
        {perms.has("quote:create") && (
          <Link
            href="/devis/nouveau"
            className="btn btn-primary inline-flex min-h-11 items-center gap-2 px-4 shadow-sm"
          >
            <span>+</span>
            <span>{t("new")}</span>
          </Link>
        )}
      </div>

      {/* Cartes d'indicateurs opérationnels (KPIs) interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* KPI 1 : Total devis */}
        <button
          type="button"
          onClick={() => setTab("all")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            tab === "all"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.totalQuotes")}</span>
            <FileText className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {totalQuotesCount}
          </span>
          <span className="text-xs text-muted">{t("kpis.totalQuotesSub")}</span>
        </button>

        {/* KPI 2 : Montant global chiffré FCFA */}
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.totalAmount")}</span>
            <TrendingUp className="size-4 text-accent" aria-hidden />
          </div>
          <span className="truncate text-xl font-bold text-foreground">
            {formatFCFA(kpis?.totalAmount ?? 0)}
          </span>
          <span className="text-xs text-muted">{t("kpis.totalAmountSub")}</span>
        </div>

        {/* KPI 3 : Devis envoyés en attente */}
        <button
          type="button"
          onClick={() => setTab("waiting")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            tab === "waiting"
              ? "border-status-warn bg-status-warn/5 ring-1 ring-status-warn"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.waiting")}</span>
            <Clock className="size-4 text-status-warn" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-status-warn">
            {counts?.waiting ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.waitingSub")}</span>
        </button>

        {/* KPI 4 : Devis acceptés / transformés */}
        <button
          type="button"
          onClick={() => setTab("decided")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            tab === "decided"
              ? "border-status-ok bg-status-ok/5 ring-1 ring-status-ok"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.accepted")}</span>
            <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-status-ok">
            {kpis?.acceptedCount ?? counts?.decided ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.acceptedSub")}</span>
        </button>

        {/* KPI 5 : Devis expirés / refusés */}
        <button
          type="button"
          onClick={() => setTab("expired")}
          className={`col-span-2 flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 sm:col-span-1 ${
            tab === "expired"
              ? "border-status-bad bg-status-bad/5 ring-1 ring-status-bad"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.expiredDeclined")}</span>
            <AlertTriangle className="size-4 text-status-bad" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {kpis?.expiredOrDeclinedCount ?? counts?.expired ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.expiredDeclinedSub")}</span>
        </button>
      </div>

      {/* Barre de filtres et d'onglets */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Champ de recherche intelligent */}
          <div className="relative min-w-[240px] flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              className="min-h-11 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder={t("filters.searchPlaceholder")}
              aria-label={t("filters.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={t("cancel")}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Filtre par Origine */}
          <Select
            aria-label={t("fields.origin")}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="min-h-11 text-xs"
          >
            <option value="">{t("filters.allOrigins")}</option>
            {["REPAIR_ORDER", "INSPECTION", "STANDALONE", "APPOINTMENT", "INSURANCE"].map((o) => (
              <option key={o} value={o}>
                {t(`origin.${o}`)}
              </option>
            ))}
          </Select>

          {/* Bouton de réinitialisation */}
          {hasActiveFilters ? (
            <Button
              variant="ghost"
              onClick={resetFilters}
              className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted hover:text-foreground"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              <span>{t("filters.resetFilters")}</span>
            </Button>
          ) : null}
        </div>

        {/* Pilules d'onglets avec compteurs en temps réel */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {TABS.filter((k) => k !== "stats" || perms.has("report:read")).map((key) => {
              const active = tab === key;
              const count =
                key === "all"
                  ? totalQuotesCount
                  : key !== "stats" && counts
                    ? counts[key]
                    : undefined;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTab(key)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-foreground text-background font-semibold shadow-sm"
                      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  <span>{t(`tabs.${key}`)}</span>
                  {count !== undefined && (
                    <span className="opacity-70">({count})</span>
                  )}
                </button>
              );
            })}
          </div>

          {tab !== "stats" && (
            <span className="text-xs text-muted">
              {t("filters.shown", { count: items.length })}
            </span>
          )}
        </div>
      </div>

      {/* Contenu principal : Onglet Statistiques ou DataTable des Devis */}
      {tab === "stats" ? (
        <QuoteStats />
      ) : list.isLoading ? (
        <ListSkeleton rows={5} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Search className="size-6" aria-hidden />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {hasActiveFilters ? t("emptyFiltered.title") : t("empty.title")}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {hasActiveFilters
              ? t("emptyFiltered.description")
              : t("empty.description")}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {hasActiveFilters ? (
              <Button variant="secondary" onClick={resetFilters}>
                <RotateCcw className="size-4" aria-hidden />
                {t("filters.resetFilters")}
              </Button>
            ) : perms.has("quote:create") ? (
              <Link href="/devis/nouveau" className="btn btn-primary">
                + {t("new")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(quote) => quote.id}
          onRowClick={(quote) => router.push(`/devis/${quote.id}`)}
        />
      )}
    </div>
  );
}
