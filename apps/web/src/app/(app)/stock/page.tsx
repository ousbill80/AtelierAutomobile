"use client";

// M07 §7 — /stock : catalogue, disponible par site, CMP, alertes mini ; recherche, scan
// (caméra ou douchette), filtres, création. Code inconnu → créer ou associer (US-M07-14).
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Package,
  Plus,
  RotateCcw,
  Scan,
  Search,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import {
  BarcodeScanner,
  Button,
  DataTable,
  EmptyState,
  Input,
  Modal,
  Select,
  StatusBadge,
  useScannerWedge,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  ProductPicker,
  scannerLabels,
  SiteSelect,
  useCan,
} from "./_lib/components";
import { errorMessage, qtyText, t } from "./_lib/i18n";
import { emptyProduct, ProductFormModal } from "./_lib/product-form";

type Filter = "all" | "belowMin" | "negative" | "inactive";
const FILTERS: Filter[] = ["all", "belowMin", "negative", "inactive"];
const PAGE = 30;

export default function StockCatalogPage() {
  const router = useRouter();
  const can = useCan();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [siteId, setSiteId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<{ barcode?: string } | null>(null);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const categories = trpc.product.categories.useQuery();
  const list = trpc.product.search.useInfiniteQuery(
    {
      q: q.trim() || undefined,
      category: category || undefined,
      filter,
      siteId: siteId || undefined,
      limit: PAGE,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );
  const items = useMemo(
    () => list.data?.pages.flatMap((page) => page.items) ?? [],
    [list.data?.pages],
  );

  const stats = useMemo(() => {
    return {
      total: items.length,
      belowMin: items.filter((p) => p.belowMin).length,
      negative: items.filter((p) => p.negative).length,
      inStock: items.filter((p) => !p.belowMin && !p.negative && p.isActive).length,
      inactive: items.filter((p) => !p.isActive).length,
    };
  }, [items]);

  const hasActiveFilters = Boolean(q.trim() || category || filter !== "all" || siteId);

  const resetFilters = useCallback(() => {
    setQ("");
    setCategory("");
    setFilter("all");
    setSiteId("");
  }, []);

  const copyToClipboard = useCallback((sku: string) => {
    void navigator.clipboard?.writeText(sku).then(() => {
      setCopiedSku(sku);
      setTimeout(() => setCopiedSku(null), 2000);
    });
  }, []);

  const associate = trpc.product.update.useMutation({
    onSuccess(product) {
      setUnknownCode(null);
      void utils.product.invalidate();
      router.push(`/stock/${product.id}`);
    },
  });

  const onCode = useCallback(
    async (code: string) => {
      setScanOpen(false);
      const result = await utils.product.search.fetch({ barcode: code, filter: "all", limit: 2 });
      if (result.items.length === 1) {
        router.push(`/stock/${result.items[0]!.id}`);
      } else if (result.items.length === 0) {
        setUnknownCode(code);
      } else {
        setQ(code);
      }
    },
    [router, utils],
  );
  useScannerWedge((code) => void onCode(code));

  const showCost = can("product:view_cost");

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="stock" />

      <PageTitle
        title={t("catalog.title")}
        description={t("catalog.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              <Scan className="size-4" aria-hidden />
              {t("common.scan")}
            </Button>
            {can("product:manage") ? (
              <Button onClick={() => setFormOpen({})}>
                <Plus className="size-4" aria-hidden />
                {t("catalog.newProduct")}
              </Button>
            ) : null}
          </div>
        }
      />

      {/* KPI Cards / Synthèse intelligente cliquable */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            filter === "all" ? "border-foreground bg-surface-2 shadow-sm" : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("catalog.stats.total")}</span>
            <Package className="size-4 text-muted" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight">{stats.total}</span>
          <span className="text-xs text-muted">{t("catalog.filters.all")}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter("all")}
          className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left transition-all hover:border-foreground/30"
        >
          <div className="flex items-center justify-between text-status-ok">
            <span className="text-xs font-medium uppercase tracking-wider">{t("catalog.stats.inStock")}</span>
            <CheckCircle2 className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-ok">{stats.inStock}</span>
          <span className="text-xs text-muted">{t("catalog.alertOk")}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter("belowMin")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-status-warn/50 ${
            filter === "belowMin" ? "border-status-warn bg-status-warn/10 shadow-sm" : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-medium uppercase tracking-wider">{t("catalog.stats.belowMin")}</span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-warn">{stats.belowMin}</span>
          <span className="text-xs text-muted">{t("catalog.alertBelowMin")}</span>
        </button>

        <button
          type="button"
          onClick={() => setFilter("negative")}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-status-bad/50 ${
            filter === "negative" ? "border-status-bad bg-status-bad/10 shadow-sm" : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-medium uppercase tracking-wider">{t("catalog.stats.negative")}</span>
            <AlertCircle className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-bad">{stats.negative}</span>
          <span className="text-xs text-muted">{t("catalog.alertNegative")}</span>
        </button>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 basis-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              type="search"
              value={q}
              placeholder={t("catalog.searchPlaceholder")}
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

          <div className="w-full sm:w-auto sm:min-w-48">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("catalog.allCategories")}</option>
              {(categories.data ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>

          <div className="w-full sm:w-auto sm:min-w-44">
            <SiteSelect value={siteId} onChange={setSiteId} allowAll />
          </div>

          {hasActiveFilters ? (
            <Button variant="ghost" onClick={resetFilters} className="text-muted hover:text-foreground">
              <RotateCcw className="size-4" aria-hidden />
              {t("catalog.resetFilters")}
            </Button>
          ) : null}
        </div>

        {/* Filtres rapides par état */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
            {FILTERS.map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={active}
                  className={`inline-flex min-h-8 items-center rounded-lg px-2.5 py-1 transition-colors ${
                    active
                      ? "bg-foreground text-background font-semibold"
                      : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-foreground"
                  }`}
                >
                  {t(`catalog.filters.${f}`)}
                  {f === "belowMin" && stats.belowMin > 0 ? (
                    <span className="ml-1.5 rounded-full bg-status-warn/20 px-1.5 py-0.2 text-[10px] text-status-warn">
                      {stats.belowMin}
                    </span>
                  ) : null}
                  {f === "negative" && stats.negative > 0 ? (
                    <span className="ml-1.5 rounded-full bg-status-bad/20 px-1.5 py-0.2 text-[10px] text-status-bad">
                      {stats.negative}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {list.data ? (
            <span className="text-xs text-muted">
              {t("catalog.itemsFound", { count: items.length })}
            </span>
          ) : null}
        </div>
      </div>

      {list.isLoading ? <ListSkeleton rows={6} /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}

      {list.data ? (
        items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center bg-surface">
            <Package className="size-12 text-muted/60 mb-3" aria-hidden />
            <h3 className="text-base font-semibold text-foreground">
              {hasActiveFilters ? t("catalog.emptyFiltered") : t("catalog.empty")}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-muted">
              {hasActiveFilters ? t("catalog.emptyFilteredHint") : t("catalog.emptyHint")}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {hasActiveFilters ? (
                <Button variant="secondary" onClick={resetFilters}>
                  <RotateCcw className="size-4" aria-hidden />
                  {t("catalog.resetFilters")}
                </Button>
              ) : null}
              {can("product:manage") ? (
                <Button onClick={() => setFormOpen({})}>
                  <Plus className="size-4" aria-hidden />
                  {t("catalog.newProduct")}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setScanOpen(true)}>
                <Scan className="size-4" aria-hidden />
                {t("common.scan")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DataTable
              rows={items}
              rowKey={(p) => p.id}
              onRowClick={(p) => router.push(`/stock/${p.id}`)}
              empty={<EmptyState title={t("catalog.empty")} description={t("catalog.emptyHint")} />}
              columns={[
                {
                  key: "name",
                  header: t("catalog.columns.name"),
                  primary: true,
                  render: (p) => (
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/stock/${p.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {p.name}
                        </Link>
                        {p.compatible ? (
                          <StatusBadge tone="ok" label={t("catalog.compatible")} />
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        {p.brand ? <span>{p.brand}</span> : null}
                        {p.brand && p.oemReference ? <span>·</span> : null}
                        {p.oemReference ? <span>Réf. {p.oemReference}</span> : null}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "sku",
                  header: t("catalog.columns.sku"),
                  render: (p) => (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground">
                        {p.sku}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(p.sku)}
                        className="rounded p-1 text-muted transition hover:bg-surface-3 hover:text-foreground"
                        title={t("catalog.copySku")}
                        aria-label={t("catalog.copySku")}
                      >
                        {copiedSku === p.sku ? (
                          <Check className="size-3.5 text-status-ok" aria-hidden />
                        ) : (
                          <Copy className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                  ),
                },
                {
                  key: "category",
                  header: t("catalog.columns.category"),
                  render: (p) =>
                    p.category ? (
                      <span className="inline-flex rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                        {p.category}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                },
                {
                  key: "available",
                  header: t("catalog.columns.available"),
                  render: (p) => {
                    if (p.levels.length === 0) return <span className="text-muted">—</span>;
                    return (
                      <div className="flex flex-col gap-1">
                        {p.levels.map((l) => (
                          <div key={l.siteId} className="flex items-center gap-1.5 text-xs">
                            <span className="rounded bg-surface-2 px-1 py-0.5 font-medium text-muted">
                              {l.siteCode}
                            </span>
                            <span
                              className={`font-semibold ${
                                l.onHand < 0
                                  ? "text-status-bad"
                                  : l.belowMin
                                  ? "text-status-warn"
                                  : "text-foreground"
                              }`}
                            >
                              {qtyText(l.available, p.quantityScale, p.unit)}
                            </span>
                            {l.minStock != null ? (
                              <span className="text-[11px] text-muted">
                                (min {qtyText(l.minStock, p.quantityScale)})
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    );
                  },
                },
                ...(showCost
                  ? [
                      {
                        key: "cost",
                        header: t("catalog.columns.cost"),
                        render: (p: (typeof items)[number]) =>
                          p.averageCost != null ? (
                            <span className="font-mono text-sm text-muted">
                              {formatFCFA(p.averageCost)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          ),
                      },
                    ]
                  : []),
                {
                  key: "price",
                  header: t("catalog.columns.price"),
                  render: (p) => (
                    <div className="flex flex-col">
                      <span className="font-mono font-semibold text-foreground">
                        {formatFCFA(p.salePrice)}
                      </span>
                      {showCost && p.marginRate != null ? (
                        <span
                          className={`text-[11px] font-medium ${
                            p.marginRate > 30
                              ? "text-status-ok"
                              : p.marginRate > 15
                              ? "text-status-warn"
                              : "text-status-bad"
                          }`}
                        >
                          +{p.marginRate.toFixed(1)} % marge
                        </span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: "alert",
                  header: t("catalog.columns.alert"),
                  render: (p) =>
                    !p.isActive ? (
                      <StatusBadge tone="off" label={t("catalog.archived")} />
                    ) : p.negative ? (
                      <StatusBadge tone="bad" label={t("catalog.alertNegative")} />
                    ) : p.belowMin ? (
                      <StatusBadge tone="warn" label={t("catalog.alertBelowMin")} />
                    ) : (
                      <StatusBadge tone="ok" label={t("catalog.alertOk")} />
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  render: (p) => (
                    <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                      <Link
                        href={`/stock/${p.id}`}
                        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                      >
                        {t("catalog.viewDetails")}
                        <ArrowRight className="size-3" aria-hidden />
                      </Link>
                    </div>
                  ),
                },
              ]}
            />
            {list.hasNextPage ? (
              <div className="flex justify-center pt-2">
                <Button
                  variant="secondary"
                  loading={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {t("common.loadMore")}
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : null}

      <BarcodeScanner
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetected={(code) => void onCode(code)}
        labels={scannerLabels()}
      />

      <Modal
        open={unknownCode !== null}
        title={t("scanner.unknownTitle", { code: unknownCode ?? "" })}
        onClose={() => setUnknownCode(null)}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("scanner.unknownBody")}</p>
          {can("product:manage") ? (
            <>
              <Button
                onClick={() => {
                  setFormOpen({ barcode: unknownCode ?? undefined });
                  setUnknownCode(null);
                }}
              >
                {t("scanner.createWithCode")}
              </Button>
              <p className="text-sm font-medium">{t("scanner.associate")}</p>
              <ProductPicker
                label={t("scanner.associate")}
                placeholder={t("scanner.associateSearch")}
                onPick={(p) => associate.mutate({ id: p.id, barcode: unknownCode })}
              />
              {associate.error ? (
                <p role="alert" className="text-sm text-status-bad">
                  {errorMessage(associate.error)}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </Modal>

      {formOpen ? (
        <ProductFormModal
          key={formOpen.barcode ?? "new"}
          open
          initial={emptyProduct({ barcode: formOpen.barcode ?? "" })}
          onClose={() => setFormOpen(null)}
          onSaved={(id) => {
            setFormOpen(null);
            router.push(`/stock/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}
