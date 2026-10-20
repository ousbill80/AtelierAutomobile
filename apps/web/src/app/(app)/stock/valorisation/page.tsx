"use client";

// M07 §7 — /stock/valorisation (US-M07-13) : valeur par site / catégorie, à date ; onglets
// « Dormantes » (RG-M07-11), « Négatifs » (RG-M07-06) et « Ventes sous coût » (RG-M07-13).
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  Download,
  Search,
  Warehouse,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  Tabs,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  downloadText,
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
} from "../_lib/components";
import { formatDay, formatDateTime, qtyText, t } from "../_lib/i18n";

type Tab = "value" | "dormant" | "negatives" | "belowCost";
const DORMANT_OPTIONS = [90, 180, 365];

export default function ValuationPage() {
  const [tab, setTab] = useState<Tab>("value");

  // Requêtes pour le bandeau de synthèse et les compteurs d'onglets
  const valuationSummary = trpc.stock.valuation.useQuery({ groupBy: "category" });
  const dormantQuery = trpc.stock.dormant.useQuery(undefined);
  const negativesQuery = trpc.stock.negatives.useQuery(undefined);
  const belowCostQuery = trpc.stock.belowCostSales.useQuery(undefined);

  const totalValue = valuationSummary.data?.total ?? 0;
  const dormantRows = dormantQuery.data?.rows ?? [];
  const dormantValue = dormantQuery.data?.totalValue ?? 0;
  const negativesCount = negativesQuery.data?.length ?? 0;
  const belowCostCount = belowCostQuery.data?.length ?? 0;

  const tabsConfig = [
    { key: "value", label: t("valuation.tabs.value") },
    {
      key: "dormant",
      label: `${t("valuation.tabs.dormant")}${dormantRows.length > 0 ? ` (${dormantRows.length})` : ""}`,
    },
    {
      key: "negatives",
      label: `${t("valuation.tabs.negatives")}${negativesCount > 0 ? ` (${negativesCount})` : ""}`,
    },
    {
      key: "belowCost",
      label: `${t("valuation.tabs.belowCost")}${belowCostCount > 0 ? ` (${belowCostCount})` : ""}`,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="stock" />

      {/* Titre et description moderne */}
      <PageTitle title={t("valuation.title")} description={t("valuation.subtitle")} />

      {/* Bandeau de synthèse avec 4 KPIs financiers interactifs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* 1. Valeur totale du stock HT */}
        <button
          type="button"
          onClick={() => setTab("value")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            tab === "value"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface hover:border-accent/40"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("valuation.kpis.totalValue")}
            </span>
            <Warehouse className="size-4 text-accent" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {formatFCFA(totalValue)}
          </div>
          <span className="mt-1 text-xs text-muted">{t("valuation.kpis.totalValueHint")}</span>
        </button>

        {/* 2. Références dormantes >90j */}
        <button
          type="button"
          onClick={() => setTab("dormant")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            tab === "dormant"
              ? "border-status-warn bg-status-warn-bg/20 ring-1 ring-status-warn"
              : "border-border bg-surface hover:border-status-warn/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("valuation.kpis.dormant")}
            </span>
            <Archive className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {dormantRows.length}
          </div>
          <span className="mt-1 text-xs text-muted">
            {t("valuation.kpis.dormantHint", {
              count: dormantRows.length,
              value: formatFCFA(dormantValue),
            })}
          </span>
        </button>

        {/* 3. Produits en stock négatif ⚠️ */}
        <button
          type="button"
          onClick={() => setTab("negatives")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            tab === "negatives"
              ? "border-status-bad bg-status-bad-bg/20 ring-1 ring-status-bad"
              : "border-border bg-surface hover:border-status-bad/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("valuation.kpis.negatives")}
            </span>
            <AlertOctagon className="size-4" aria-hidden />
          </div>
          <div
            className={`mt-2 text-2xl font-bold tracking-tight ${
              negativesCount > 0 ? "text-status-bad" : "text-status-ok"
            }`}
          >
            {negativesCount}
          </div>
          <span className="mt-1 text-xs text-muted">
            {negativesCount > 0
              ? t("valuation.kpis.negativesHint", { count: negativesCount })
              : t("valuation.kpis.negativesZero")}
          </span>
        </button>

        {/* 4. Ventes sous coût CMP */}
        <button
          type="button"
          onClick={() => setTab("belowCost")}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            tab === "belowCost"
              ? "border-status-warn bg-status-warn-bg/20 ring-1 ring-status-warn"
              : "border-border bg-surface hover:border-status-warn/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("valuation.kpis.belowCost")}
            </span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <div
            className={`mt-2 text-2xl font-bold tracking-tight ${
              belowCostCount > 0 ? "text-status-warn" : "text-status-ok"
            }`}
          >
            {belowCostCount}
          </div>
          <span className="mt-1 text-xs text-muted">
            {belowCostCount > 0
              ? t("valuation.kpis.belowCostHint", { count: belowCostCount })
              : t("valuation.kpis.belowCostZero")}
          </span>
        </button>
      </div>

      {/* Barre d'onglets */}
      <Tabs activeKey={tab} onChange={(k) => setTab(k as Tab)} items={tabsConfig} />

      {/* Contenu des onglets */}
      {tab === "value" ? <ValueTab /> : null}
      {tab === "dormant" ? <DormantTab /> : null}
      {tab === "negatives" ? <NegativesTab /> : null}
      {tab === "belowCost" ? <BelowCostTab /> : null}
    </div>
  );
}

function ValueTab() {
  const [groupBy, setGroupBy] = useState<"category" | "site">("category");
  const [siteId, setSiteId] = useState("");
  const [at, setAt] = useState("");
  const [exported, setExported] = useState(false);
  const [search, setSearch] = useState("");

  const query = trpc.stock.valuation.useQuery({
    groupBy,
    siteId: siteId || undefined,
    at: at || undefined,
  });

  const totalValue = query.data?.total ?? 0;
  const groups = useMemo(() => query.data?.groups ?? [], [query.data?.groups]);
  const totalItems = useMemo(() => groups.reduce((acc, g) => acc + g.items, 0), [groups]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => (g.label || t("valuation.noCategory")).toLowerCase().includes(q));
  }, [groups, search]);

  const handleExport = () => {
    if (!query.data) return;
    downloadText(
      "valorisation-stock.csv",
      [
        `${groupBy === "site" ? t("valuation.bySite") : t("valuation.byCategory")};Valeur (FCFA);Références`,
        ...query.data.groups.map(
          (g) => `${g.label || t("valuation.noCategory")};${g.value};${g.items}`,
        ),
        `${t("common.total")};${query.data.total};`,
      ].join("\n"),
    );
    setExported(true);
    setTimeout(() => setExported(false), 3000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filtres et sélections */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-3">
        <Field label={t("valuation.groupBy")}>
          <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="category">{t("valuation.byCategory")}</option>
            <option value="site">{t("valuation.bySite")}</option>
          </Select>
        </Field>
        <SiteSelect value={siteId} onChange={setSiteId} allowAll />
        <Input
          label={t("valuation.at")}
          type="date"
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </div>

      {query.isLoading ? <ListSkeleton rows={4} /> : null}
      {query.isError ? <ErrorBox onRetry={() => query.refetch()} /> : null}

      {query.data ? (
        <>
          {/* Cartes KPI récapitulatives */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm sm:col-span-2">
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t("valuation.total")} · {at ? formatDay(at) : t("valuation.today")}
                </span>
                <Warehouse className="size-4 text-accent" aria-hidden />
              </div>
              <div
                className="text-3xl font-bold tracking-tight text-foreground"
                data-testid="valuation-total"
              >
                {formatFCFA(totalValue)}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted">
                <span>
                  {t("valuation.groupCount", { count: groups.length })} ·{" "}
                  {t("valuation.catalogItems", { count: totalItems })}
                </span>
                <div className="flex items-center gap-2">
                  {exported ? (
                    <span className="inline-flex items-center gap-1 font-medium text-status-ok">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("valuation.exportDone")}
                    </span>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={handleExport}>
                    <Download className="mr-1.5 size-3.5" aria-hidden />
                    {t("valuation.export")}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between text-muted">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t("valuation.averagePerItem")}
                </span>
                <BarChart3 className="size-4 text-muted" aria-hidden />
              </div>
              <div className="text-2xl font-bold tracking-tight">
                {totalItems > 0 ? formatFCFA(Math.round(totalValue / totalItems)) : "0 FCFA"}
              </div>
              <span className="text-xs text-muted">{t("valuation.averagePerItemHint")}</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("valuation.searchPlaceholder")}
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            <p className="text-xs text-muted">{t("valuation.negativesHint")}</p>
          </div>

          {/* Grille des groupes / catégories */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map((g) => {
              const share = totalValue > 0 ? Math.round((g.value / totalValue) * 100) : 0;
              return (
                <div
                  key={g.key}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold text-foreground">
                        {g.label || t("valuation.noCategory")}
                      </h4>
                      <p className="text-xs text-muted">
                        {t("valuation.items", { count: g.items })}
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted">
                      {share}%
                    </span>
                  </div>

                  <div>
                    <div className="text-lg font-bold tracking-tight text-foreground">
                      {formatFCFA(g.value)}
                    </div>
                    {/* Barre de répartition */}
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${Math.min(100, Math.max(2, share))}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DormantTab() {
  const [days, setDays] = useState<number | undefined>(undefined);
  const [search, setSearch] = useState("");
  const query = trpc.stock.dormant.useQuery({ days });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data?.rows]);
  const totalValue = query.data?.totalValue ?? 0;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    const over365 = rows.filter((r) => r.bucket === "over_365").length;
    const over180 = rows.filter((r) => r.bucket === "180_365").length;
    const over90 = rows.filter((r) => r.bucket === "90_180").length;
    return { over365, over180, over90 };
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      {/* Contrôles et recherche instantanée */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full max-w-xs">
          <Field label={t("valuation.dormantDays")}>
            <Select
              value={days ?? ""}
              onChange={(e) => setDays(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">
                {query.data ? t("valuation.dormantDaysOption", { days: query.data.days }) : "—"}
              </option>
              {DORMANT_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {t("valuation.dormantDaysOption", { days: d })}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("valuation.searchDormant")}
            className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      {query.isLoading ? <ListSkeleton rows={4} /> : null}
      {query.isError ? <ErrorBox onRetry={() => query.refetch()} /> : null}

      {query.data ? (
        <>
          {/* Cartes KPI dormants */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between text-status-warn">
                <span className="text-xs font-semibold uppercase tracking-wider">
                  {t("valuation.dormantTotal", { value: "" })}
                </span>
                <Archive className="size-4 text-status-warn" aria-hidden />
              </div>
              <span className="text-2xl font-bold tracking-tight text-status-warn">
                {formatFCFA(totalValue)}
              </span>
              <span className="text-xs text-muted">
                {t("valuation.items", { count: rows.length })}
              </span>
            </div>

            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                90–180 j
              </span>
              <span className="text-2xl font-bold tracking-tight">{stats.over90}</span>
              <span className="text-xs text-muted">Ralentissement</span>
            </div>

            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                180–365 j
              </span>
              <span className="text-2xl font-bold tracking-tight">{stats.over180}</span>
              <span className="text-xs text-muted">Forte stagnation</span>
            </div>

            <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <span className="text-xs font-semibold uppercase tracking-wider text-status-bad">
                &gt; 365 j
              </span>
              <span className="text-2xl font-bold tracking-tight text-status-bad">
                {stats.over365}
              </span>
              <span className="text-xs text-muted">Risque dépréciation</span>
            </div>
          </div>

          <DataTable
            rows={filteredRows}
            rowKey={(r) => r.productId}
            empty={<EmptyState title={t("valuation.noDormant")} />}
            columns={[
              {
                key: "name",
                header: t("common.product"),
                primary: true,
                render: (r) => (
                  <div className="flex flex-col">
                    <Link
                      href={`/stock/${r.productId}`}
                      className="font-semibold text-foreground hover:underline"
                    >
                      {r.name}
                    </Link>
                    <span className="text-xs text-muted">{r.sku}</span>
                  </div>
                ),
              },
              {
                key: "qty",
                header: t("product.level.onHand"),
                render: (r) => (
                  <span className="font-medium">{qtyText(r.onHand, r.quantityScale, r.unit)}</span>
                ),
              },
              {
                key: "value",
                header: t("movements.columns.value"),
                render: (r) => (
                  <span className="font-semibold text-foreground">{formatFCFA(r.value)}</span>
                ),
              },
              {
                key: "last",
                header: t("product.lastIssuedAt"),
                render: (r) =>
                  r.lastIssuedAt ? (
                    <div className="flex flex-col text-xs">
                      <span className="font-medium text-foreground">
                        {formatDay(r.lastIssuedAt)}
                      </span>
                      <span className="text-muted">{t("valuation.daysAgo", { days: r.days })}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted italic">{t("valuation.neverIssued")}</span>
                  ),
              },
              {
                key: "bucket",
                header: t("common.status"),
                render: (r) => (
                  <StatusBadge
                    tone={r.bucket === "over_365" ? "bad" : "warn"}
                    label={t(`valuation.dormantBucket.${r.bucket}`, { days: query.data.days })}
                  />
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

function NegativesTab() {
  const [search, setSearch] = useState("");
  const query = trpc.stock.negatives.useQuery();

  const negatives = useMemo(() => query.data ?? [], [query.data]);

  const filteredNegatives = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return negatives;
    return negatives.filter(
      (l) =>
        l.product.name.toLowerCase().includes(q) ||
        l.product.sku.toLowerCase().includes(q) ||
        l.site.code.toLowerCase().includes(q),
    );
  }, [negatives, search]);

  if (query.isLoading) return <ListSkeleton rows={3} />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      {negatives.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-status-bad/30 bg-status-bad-bg/10 p-4 text-status-bad">
          <AlertOctagon className="size-5 shrink-0" aria-hidden />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">
              {t("valuation.negativesAlertTitle", { count: negatives.length })}
            </span>
            <span className="text-muted text-xs">{t("valuation.negativesAlertDesc")}</span>
          </div>
        </div>
      ) : null}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("valuation.searchNegatives")}
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <DataTable
        rows={filteredNegatives}
        rowKey={(l) => l.id}
        empty={
          <EmptyState
            title={t("valuation.noNegatives")}
            description={t("valuation.negativesEmptyDesc")}
          />
        }
        columns={[
          {
            key: "name",
            header: t("common.product"),
            primary: true,
            render: (l) => (
              <div className="flex flex-col">
                <Link href={`/stock/${l.product.id}`} className="font-semibold hover:underline">
                  {l.product.name}
                </Link>
                <span className="text-xs text-muted">{l.product.sku}</span>
              </div>
            ),
          },
          {
            key: "site",
            header: t("common.site"),
            render: (l) => (
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium">
                {l.site.code}
              </span>
            ),
          },
          {
            key: "qty",
            header: t("product.level.onHand"),
            render: (l) => (
              <StatusBadge
                tone="bad"
                label={qtyText(l.onHand, l.product.quantityScale, l.product.unit)}
              />
            ),
          },
          {
            key: "action",
            header: "",
            align: "right",
            render: (l) => (
              <Link
                href={`/stock/${l.product.id}`}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
              >
                {t("valuation.inspectProduct")}
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}

type BelowCostPayload = {
  productId?: string;
  productName?: string;
  sku?: string;
  unitPrice?: number;
  averageCost?: number;
  salePrice?: number;
  netPrice?: number;
  discountRate?: number;
  reason?: string;
  loss?: number;
  repairOrderId?: string;
  repairOrderNumber?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  [key: string]: unknown;
};

function BelowCostTab() {
  const [search, setSearch] = useState("");
  const query = trpc.stock.belowCostSales.useQuery();

  const events = useMemo(() => query.data ?? [], [query.data]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) => {
      const payload = (e.payload ?? {}) as BelowCostPayload;
      const nameMatch = payload.productName?.toLowerCase().includes(q) ?? false;
      const skuMatch = payload.sku?.toLowerCase().includes(q) ?? false;
      const roMatch = payload.repairOrderNumber?.toLowerCase().includes(q) ?? false;
      const invMatch = payload.invoiceNumber?.toLowerCase().includes(q) ?? false;
      return nameMatch || skuMatch || roMatch || invMatch;
    });
  }, [events, search]);

  if (query.isLoading) return <ListSkeleton rows={3} />;
  if (query.isError || !query.data) return <ErrorBox onRetry={() => query.refetch()} />;

  if (events.length === 0) {
    return (
      <EmptyState title={t("valuation.noBelowCost")} description={t("valuation.belowCostHint")} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="size-5 text-status-warn" aria-hidden />
          <div>
            <h4 className="font-semibold text-foreground">
              {t("valuation.belowCostAlertTitle", { count: events.length })}
            </h4>
            <p className="text-xs text-muted">{t("valuation.belowCostAlertDesc")}</p>
          </div>
        </div>

        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("valuation.searchBelowCost")}
            className="h-10 w-full rounded-lg border border-border bg-surface-2 pl-9 pr-8 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {filteredEvents.map((e) => {
          const payload = (e.payload ?? {}) as BelowCostPayload;
          const netPrice = payload.netPrice ?? payload.unitPrice;
          const averageCost = payload.averageCost;
          const unitLoss =
            payload.loss ??
            (typeof netPrice === "number" && typeof averageCost === "number"
              ? averageCost - netPrice
              : null);

          return (
            <li
              key={e.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-status-warn/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <StatusBadge tone="bad" label={t("valuation.belowCostBadge")} />
                  <span className="text-xs text-muted">{formatDateTime(e.occurredAt)}</span>
                </div>
                {unitLoss != null && unitLoss > 0 ? (
                  <span className="text-sm font-semibold text-status-bad">
                    {t("valuation.unitLoss", { loss: formatFCFA(unitLoss) })}
                  </span>
                ) : null}
              </div>

              {/* Détails structurés */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <span className="text-xs text-muted">{t("valuation.designationSku")}</span>
                  <p className="font-semibold text-foreground">
                    {payload.productName ?? payload.sku ?? t("valuation.unspecifiedProduct")}
                  </p>
                  {payload.sku ? <span className="text-xs text-muted">{payload.sku}</span> : null}
                </div>

                <div>
                  <span className="text-xs text-muted">{t("valuation.netInvoicedPrice")}</span>
                  <p className="font-semibold text-foreground">
                    {typeof netPrice === "number" ? formatFCFA(netPrice) : "—"}
                  </p>
                  {payload.discountRate ? (
                    <span className="text-xs text-muted">
                      {t("valuation.discountLabel", { rate: payload.discountRate })}
                    </span>
                  ) : null}
                </div>

                <div>
                  <span className="text-xs text-muted">{t("valuation.averageCostLabel")}</span>
                  <p className="font-semibold text-foreground">
                    {typeof averageCost === "number" ? formatFCFA(averageCost) : "—"}
                  </p>
                </div>

                <div>
                  <span className="text-xs text-muted">{t("valuation.linkedDoc")}</span>
                  <p className="font-semibold text-foreground">
                    {payload.repairOrderNumber
                      ? t("valuation.repairOrderLabel", { number: payload.repairOrderNumber })
                      : payload.invoiceNumber
                        ? t("valuation.invoiceLabel", { number: payload.invoiceNumber })
                        : t("valuation.directSale")}
                  </p>
                </div>
              </div>

              {payload.reason ? (
                <div className="rounded-lg bg-surface-2 p-2.5 text-xs text-muted">
                  <span className="font-medium text-foreground">
                    {t("valuation.justifiedReason")}{" "}
                  </span>
                  « {payload.reason} »
                </div>
              ) : null}

              {/* Accordéon technique pour payload JSON brut */}
              <details className="text-xs text-muted">
                <summary className="cursor-pointer font-medium hover:text-foreground">
                  {t("valuation.showTechnicalMeta")}
                </summary>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-2.5 text-[11px] text-foreground">
                  {JSON.stringify(e.payload, null, 2)}
                </pre>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
