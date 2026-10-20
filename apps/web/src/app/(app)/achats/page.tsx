"use client";

// M07 §7 — /achats : bons de commande par statut, fournisseur, retards (`expectedAt` dépassée).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  FileText,
  Package,
  Plus,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, DataTable, EmptyState, Input, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton, ModuleNav, PageTitle, useCan } from "../stock/_lib/components";
import { formatDay, PO_TONE, t } from "../stock/_lib/i18n";
import { CreatePurchaseOrderModal } from "./_lib/po-form";

const STATUSES = ["DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;
type Status = (typeof STATUSES)[number];

export default function PurchasesPage() {
  const router = useRouter();
  const can = useCan();
  const [status, setStatus] = useState<Status | undefined>(undefined);
  const [late, setLate] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);

  // Requête globale sans filtre pour alimenter instantanément compteurs et KPIs
  const allList = trpc.purchaseOrder.list.useQuery({});
  const allOrders = useMemo(() => allList.data ?? [], [allList.data]);

  // KPIs & statistiques dynamiques
  const stats = useMemo(() => {
    const active = allOrders.filter(
      (po) => po.status === "DRAFT" || po.status === "SENT" || po.status === "PARTIALLY_RECEIVED",
    ).length;
    const lateCount = allOrders.filter((po) => po.late).length;
    const partialCount = allOrders.filter((po) => po.status === "PARTIALLY_RECEIVED").length;
    const totalCommitted = allOrders
      .filter((po) => po.status !== "CANCELLED")
      .reduce((s, po) => s + po.total, 0);

    const countsByStatus: Record<string, number> = {};
    for (const s of STATUSES) {
      countsByStatus[s] = allOrders.filter((po) => po.status === s).length;
    }

    return { active, lateCount, partialCount, totalCommitted, countsByStatus };
  }, [allOrders]);

  // Filtrage combiné (statut, retards, recherche textuelle)
  const filteredOrders = useMemo(() => {
    const query = q.trim().toLowerCase();
    return allOrders.filter((po) => {
      if (status && po.status !== status) return false;
      if (late && !po.late) return false;
      if (query) {
        const matchesNumber = po.number.toLowerCase().includes(query);
        const matchesSupplier = po.supplier.name.toLowerCase().includes(query);
        const matchesSite = po.siteCode.toLowerCase().includes(query);
        if (!matchesNumber && !matchesSupplier && !matchesSite) return false;
      }
      return true;
    });
  }, [allOrders, status, late, q]);

  const hasActiveFilters = Boolean(status !== undefined || late || q.trim());

  const resetFilters = () => {
    setStatus(undefined);
    setLate(false);
    setQ("");
  };

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="purchases" />

      <PageTitle
        title={t("purchases.title")}
        description={t("purchases.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/achats/suggestions"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition hover:bg-surface-2"
            >
              <Sparkles className="size-4 text-accent" aria-hidden />
              {t("suggestions.title")}
            </Link>
            {can("purchase:create") ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                {t("purchases.new")}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* KPI Cards / Synthèse opérationnelle Achats cliquable */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            setStatus(undefined);
            setLate(false);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            status === undefined && !late
              ? "border-foreground bg-surface-2 shadow-sm"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("purchases.stats.active")}
            </span>
            <ShoppingBag className="size-4 text-muted" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight">{stats.active}</span>
          <span className="text-xs text-muted">{allOrders.length} bons au total</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setLate(true);
            setStatus(undefined);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-status-bad/50 ${
            late
              ? "border-status-bad bg-status-bad/10 shadow-sm"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("purchases.stats.late")}
            </span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-bad">{stats.lateCount}</span>
          <span className="text-xs text-muted">{t("purchases.lateOnly")}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatus("PARTIALLY_RECEIVED");
            setLate(false);
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-status-warn/50 ${
            status === "PARTIALLY_RECEIVED"
              ? "border-status-warn bg-status-warn/10 shadow-sm"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("purchases.stats.partial")}
            </span>
            <Package className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-warn">
            {stats.partialCount}
          </span>
          <span className="text-xs text-muted">{t("purchases.status.PARTIALLY_RECEIVED")}</span>
        </button>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-status-ok">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("purchases.stats.totalCommitted")}
            </span>
            <TrendingUp className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-ok">
            {formatFCFA(stats.totalCommitted)}
          </span>
          <span className="text-xs text-muted">Commandes en cours HT</span>
        </div>
      </div>

      {/* Barre de filtres & recherche */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <Input
              type="search"
              value={q}
              placeholder={t("purchases.searchPlaceholder")}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 pr-9"
            />
            {q ? (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={t("common.cancel")}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setLate(!late)}
            aria-pressed={late}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${
              late
                ? "border-status-bad bg-status-bad/10 text-status-bad font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <AlertTriangle className="size-4" aria-hidden />
            {t("purchases.lateOnly")}
            {stats.lateCount > 0 ? (
              <span className="rounded-full bg-status-bad/20 px-1.5 py-0.2 text-xs font-bold text-status-bad">
                {stats.lateCount}
              </span>
            ) : null}
          </button>

          {hasActiveFilters ? (
            <Button variant="ghost" onClick={resetFilters} className="text-muted hover:text-foreground">
              <RotateCcw className="size-4" aria-hidden />
              {t("purchases.resetFilters")}
            </Button>
          ) : null}
        </div>

        {/* Onglets de statuts avec compteurs en temps réel */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              aria-pressed={status === undefined}
              onClick={() => setStatus(undefined)}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors ${
                status === undefined
                  ? "bg-foreground text-background font-semibold"
                  : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
              }`}
            >
              {t("purchases.allStatuses")}
              <span className="opacity-70">({allOrders.length})</span>
            </button>
            {STATUSES.map((s) => {
              const active = status === s;
              const count = stats.countsByStatus[s] ?? 0;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(s)}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition-colors ${
                    active
                      ? "bg-foreground text-background font-semibold"
                      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  {t(`purchases.status.${s}`)}
                  <span className="opacity-70">({count})</span>
                </button>
              );
            })}
          </div>

          <span className="text-xs text-muted">
            {filteredOrders.length} bon(s) affiché(s)
          </span>
        </div>
      </div>

      {allList.isLoading ? <ListSkeleton rows={5} /> : null}
      {allList.isError ? <ErrorBox onRetry={() => allList.refetch()} /> : null}

      {allList.data ? (
        filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center bg-surface">
            <FileText className="size-12 text-muted/60 mb-3" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">
              {hasActiveFilters ? t("purchases.emptyFiltered") : t("purchases.empty")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-muted">
              {hasActiveFilters
                ? t("purchases.emptyFilteredHint")
                : t("purchases.emptySuggestionsHint")}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {hasActiveFilters ? (
                <Button variant="secondary" onClick={resetFilters}>
                  <RotateCcw className="size-4" aria-hidden />
                  {t("purchases.resetFilters")}
                </Button>
              ) : null}
              {can("purchase:create") ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4" aria-hidden />
                  {t("purchases.new")}
                </Button>
              ) : null}
              <Link
                href="/achats/suggestions"
                className="btn btn-secondary inline-flex min-h-10 items-center gap-2"
              >
                <Sparkles className="size-4 text-accent" aria-hidden />
                {t("suggestions.title")}
              </Link>
            </div>
          </div>
        ) : (
          <DataTable
            rows={filteredOrders}
            rowKey={(po) => po.id}
            onRowClick={(po) => router.push(`/achats/${po.id}`)}
            empty={<EmptyState title={t("purchases.empty")} />}
            columns={[
              {
                key: "number",
                header: t("purchases.columns.number"),
                primary: true,
                render: (po) => (
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-muted" aria-hidden />
                    <Link
                      href={`/achats/${po.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {po.number}
                    </Link>
                  </div>
                ),
              },
              {
                key: "supplier",
                header: t("purchases.columns.supplier"),
                render: (po) => (
                  <Link
                    href={`/achats/fournisseurs/${po.supplier.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-medium text-foreground hover:underline"
                  >
                    {po.supplier.name}
                  </Link>
                ),
              },
              {
                key: "site",
                header: t("purchases.columns.site"),
                render: (po) => (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-xs text-muted">
                    {po.siteCode}
                  </span>
                ),
              },
              {
                key: "lines",
                header: t("purchases.lines"),
                render: (po) => (
                  <span className="text-xs text-muted">
                    {po.lines} article{po.lines > 1 ? "s" : ""}
                  </span>
                ),
              },
              {
                key: "total",
                header: t("purchases.columns.total"),
                render: (po) => (
                  <span className="font-mono font-semibold text-foreground">
                    {formatFCFA(po.total)}
                  </span>
                ),
              },
              {
                key: "ordered",
                header: t("purchases.columns.orderedAt"),
                render: (po) => (
                  <span className="text-xs text-muted">
                    {formatDay(po.orderedAt ?? po.createdAt)}
                  </span>
                ),
              },
              {
                key: "expected",
                header: t("purchases.columns.expectedAt"),
                render: (po) => (
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{formatDay(po.expectedAt)}</span>
                    {po.late ? (
                      <span className="text-[11px] font-semibold text-status-bad">
                        {t("purchases.late")}
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                key: "status",
                header: t("purchases.columns.status"),
                render: (po) => (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      tone={PO_TONE[po.status] ?? "off"}
                      label={t(`purchases.status.${po.status}`)}
                    />
                    {po.late && po.status !== "RECEIVED" && po.status !== "CANCELLED" ? (
                      <StatusBadge tone="bad" label={t("purchases.late")} />
                    ) : null}
                  </div>
                ),
              },
              {
                key: "actions",
                header: "",
                render: (po) => (
                  <div
                    className="flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <a
                      href={`/api/achats/${po.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1.5 text-muted transition hover:bg-surface-2 hover:text-foreground"
                      title={t("purchases.downloadPdf")}
                      aria-label={t("purchases.downloadPdf")}
                    >
                      <Download className="size-4" aria-hidden />
                    </a>
                    <Link
                      href={`/achats/${po.id}`}
                      className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                    >
                      {t("purchases.viewDetails")}
                      <ArrowRight className="size-3" aria-hidden />
                    </Link>
                  </div>
                ),
              },
            ]}
          />
        )
      ) : null}

      {creating ? (
        <CreatePurchaseOrderModal
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/achats/${id}`)}
        />
      ) : null}
    </div>
  );
}
