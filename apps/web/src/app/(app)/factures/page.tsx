"use client";

// M08 §7 — /factures : KPIs opérationnels interactifs (factures émises, CA TTC, impayées,
// payées, avoirs), recherche intelligente instantanée, onglets de vue avec compteurs en direct,
// DataTable enrichie et responsive, alertes d'échéance et actions rapides.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
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
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay } from "@/components/repair-orders/i18n";
import { FneBadge, InvoiceStatusBadge } from "@/components/billing/badges";
import { t } from "@/components/billing/i18n";

const VIEWS = ["all", "drafts", "open", "paid", "fne_pending", "credit_notes"] as const;
type View = (typeof VIEWS)[number];

export default function InvoicesPage() {
  const router = useRouter();
  const me = trpc.me.get.useQuery();
  const perms = useMemo(() => new Set(me.data?.permissions ?? []), [me.data?.permissions]);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const list = trpc.invoice.list.useQuery(
    { view, q: q.trim() || undefined },
    { refetchInterval: 30_000 },
  );

  const kpis = list.data?.kpis;
  const fnePendingCount = list.data?.fnePendingCount ?? 0;
  const timeZone = list.data?.timeZone;
  const rawItems = useMemo(() => list.data?.items ?? [], [list.data?.items]);

  // Filtrage additionnel pour les retards de règlement
  const displayItems = useMemo(() => {
    if (!overdueOnly) return rawItems;
    return rawItems.filter((inv) => inv.isOverdue || inv.status === "OVERDUE");
  }, [rawItems, overdueOnly]);

  const hasActiveFilters = Boolean(q.trim() || view !== "all" || overdueOnly);

  const resetFilters = useCallback(() => {
    setQ("");
    setView("all");
    setOverdueOnly(false);
  }, []);

  type InvoiceItem = (typeof rawItems)[number];

  const columns: DataTableColumn<InvoiceItem>[] = useMemo(
    () => [
      {
        key: "number",
        header: t("columns.number"),
        primary: true,
        render: (inv) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm font-semibold text-foreground">
                {inv.number ?? t("draft")}
              </span>
              {inv.type !== "INVOICE" && (
                <span className="rounded bg-surface-2 px-1.5 py-0.2 text-[10px] font-semibold text-muted">
                  {t(`type.${inv.type}`)}
                </span>
              )}
            </div>
            <span className="text-xs text-muted">
              {formatDay(inv.issuedAt ?? inv.createdAt, timeZone)}
            </span>
          </div>
        ),
      },
      {
        key: "customerVehicle",
        header: t("columns.customerVehicle"),
        render: (inv) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {inv.customer.displayName}
              </span>
              {inv.billTo === "INSURANCE" && (
                <span className="rounded bg-accent/10 px-1 py-0.2 text-[10px] font-semibold text-accent">
                  {t("billTo.INSURANCE")}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {inv.vehicle && <PlateBadge plate={inv.vehicle.plate} />}
              {inv.repairOrder && (
                <span className="font-mono text-xs text-muted">
                  OR {inv.repairOrder.number}
                </span>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "status",
        header: t("columns.status"),
        render: (inv) => (
          <div className="flex flex-col gap-1">
            <InvoiceStatusBadge status={inv.status} />
          </div>
        ),
      },
      {
        key: "fne",
        header: t("columns.fne"),
        render: (inv) => (
          <div>
            {inv.status !== "DRAFT" ? (
              <FneBadge status={inv.fneStatus} />
            ) : (
              <span className="text-xs text-muted">—</span>
            )}
          </div>
        ),
      },
      {
        key: "dates",
        header: t("columns.dates"),
        render: (inv) => {
          const isOverdue = inv.isOverdue || inv.status === "OVERDUE";
          return (
            <div className="flex flex-col text-xs">
              {inv.dueDate && inv.type !== "CREDIT_NOTE" ? (
                <span
                  className={
                    isOverdue
                      ? "font-semibold text-status-bad"
                      : "text-muted"
                  }
                >
                  {isOverdue ? "⚠️ " : ""}
                  {t("fields.dueDate")} {formatDay(inv.dueDate, "UTC")}
                </span>
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
          );
        },
      },
      {
        key: "total",
        header: t("columns.total"),
        render: (inv) => (
          <span className="text-sm font-bold text-foreground">
            {formatFCFA(inv.total)}
          </span>
        ),
      },
      {
        key: "balance",
        header: t("columns.balance"),
        render: (inv) => {
          if (inv.status === "DRAFT" || inv.type === "CREDIT_NOTE") {
            return <span className="text-xs text-muted">—</span>;
          }
          if (inv.balance <= 0) {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-ok">
                <CheckCircle2 className="size-3" aria-hidden />
                <span>{t("status.PAID")}</span>
              </span>
            );
          }
          return (
            <span className="text-xs font-bold text-status-bad">
              {formatFCFA(inv.balance)}
            </span>
          );
        },
      },
      {
        key: "actions",
        header: t("columns.actions"),
        render: (inv) => (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <a
              href={`/api/factures/${inv.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              title={t("actions.pdf")}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              <Download className="size-4" aria-hidden />
            </a>
            <Link
              href={`/factures/${inv.id}`}
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
        <div className="flex flex-wrap items-center gap-2">
          {perms.has("accounting:export") && (
            <Link
              href="/factures/exports"
              className="btn btn-secondary inline-flex min-h-11 items-center gap-2 px-3 text-sm shadow-sm"
            >
              <FileSpreadsheet className="size-4 text-muted" aria-hidden />
              <span>{t("exports.title")}</span>
            </Link>
          )}
          {perms.has("invoice:create") && (
            <Link
              href="/factures/nouvelle"
              className="btn btn-primary inline-flex min-h-11 items-center gap-2 px-4 shadow-sm"
            >
              <span>+</span>
              <span>{t("new")}</span>
            </Link>
          )}
        </div>
      </div>

      {/* Cartes d'indicateurs opérationnels (KPIs) interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* KPI 1 : Total factures émises */}
        <button
          type="button"
          onClick={() => {
            setView("all");
            setOverdueOnly(false);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            view === "all" && !overdueOnly
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.totalInvoiced")}</span>
            <FileText className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {kpis?.invoiceCount ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.totalInvoicedSub")}</span>
        </button>

        {/* KPI 2 : Chiffre d'affaires facturé FCFA */}
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.revenue")}</span>
            <TrendingUp className="size-4 text-accent" aria-hidden />
          </div>
          <span className="truncate text-xl font-bold text-foreground">
            {formatFCFA(kpis?.totalInvoiced ?? 0)}
          </span>
          <span className="text-xs text-muted">{t("kpis.revenueSub")}</span>
        </div>

        {/* KPI 3 : Factures impayées & en retard de règlement */}
        <button
          type="button"
          onClick={() => {
            setOverdueOnly((prev) => !prev);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            overdueOnly
              ? "border-status-bad bg-status-bad/10 ring-1 ring-status-bad"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-status-bad">
              {t("kpis.overdue")}
            </span>
            <AlertTriangle className="size-4 text-status-bad" aria-hidden />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-status-bad">
              {kpis?.overdueCount ?? 0}
            </span>
            {(kpis?.overdueCount ?? 0) > 0 && (
              <span className="rounded-full bg-status-bad/20 px-1.5 py-0.5 text-[10px] font-bold text-status-bad">
                ⚠️
              </span>
            )}
          </div>
          <span className="text-xs text-muted">{t("kpis.overdueSub")}</span>
        </button>

        {/* KPI 4 : Factures payées */}
        <button
          type="button"
          onClick={() => {
            setView("paid");
            setOverdueOnly(false);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            view === "paid" && !overdueOnly
              ? "border-status-ok bg-status-ok/5 ring-1 ring-status-ok"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.paid")}</span>
            <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-status-ok">
            {kpis?.paidCount ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.paidSub")}</span>
        </button>

        {/* KPI 5 : Avoirs */}
        <button
          type="button"
          onClick={() => {
            setView("credit_notes");
            setOverdueOnly(false);
          }}
          className={`col-span-2 flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 sm:col-span-1 ${
            view === "credit_notes"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.creditNotes")}</span>
            <FileText className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {kpis?.creditNoteCount ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.creditNotesSub")}</span>
        </button>
      </div>

      {/* Barre de recherche et de filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Recherche intelligente */}
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
                aria-label={t("back")}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Filtre En retard uniquement */}
          <button
            type="button"
            onClick={() => setOverdueOnly(!overdueOnly)}
            aria-pressed={overdueOnly}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
              overdueOnly
                ? "border-status-bad bg-status-bad/10 text-status-bad font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <AlertTriangle className="size-3.5" aria-hidden />
            <span>{t("filters.overdueOnly")}</span>
            {(kpis?.overdueCount ?? 0) > 0 && (
              <span className="rounded-full bg-status-bad/20 px-1.5 py-0.2 text-[10px] font-bold text-status-bad">
                {kpis?.overdueCount}
              </span>
            )}
          </button>

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

        {/* Pilules de vues avec compteurs en temps réel */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {VIEWS.map((key) => {
              const active = view === key;
              let count: number | undefined;
              if (key === "drafts" && kpis) count = kpis.draftCount;
              if (key === "paid" && kpis) count = kpis.paidCount;
              if (key === "credit_notes" && kpis) count = kpis.creditNoteCount;
              if (key === "fne_pending") count = fnePendingCount;
              if (key === "all" && kpis) count = kpis.invoiceCount;

              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setView(key)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-foreground text-background font-semibold shadow-sm"
                      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  <span>{t(`views.${key}`)}</span>
                  {count !== undefined && count > 0 && (
                    <span
                      className={`opacity-80 ${
                        key === "fne_pending"
                          ? "rounded bg-status-bad/30 px-1 text-status-bad font-bold"
                          : ""
                      }`}
                    >
                      ({count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <span className="text-xs text-muted">
            {t("filters.shown", { count: displayItems.length })}
          </span>
        </div>
      </div>

      {/* Contenu principal : Liste / DataTable */}
      {list.isLoading ? (
        <ListSkeleton rows={5} />
      ) : list.isError || !list.data ? (
        <ErrorBox onRetry={() => list.refetch()} message={t("loadError")} />
      ) : displayItems.length === 0 ? (
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
            ) : perms.has("invoice:create") ? (
              <Link href="/factures/nouvelle" className="btn btn-primary">
                + {t("new")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={displayItems}
          rowKey={(inv) => inv.id}
          onRowClick={(inv) => router.push(`/factures/${inv.id}`)}
        />
      )}
    </div>
  );
}
