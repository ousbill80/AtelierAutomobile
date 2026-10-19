"use client";

// M07 §7 — /stock : catalogue, disponible par site, CMP, alertes mini ; recherche, scan
// (caméra ou douchette), filtres, création. Code inconnu → créer ou associer (US-M07-14).
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatFCFA } from "@atelieros/core/money";
import {
  BarcodeScanner,
  Button,
  DataTable,
  EmptyState,
  Field,
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
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
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
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle
        title={t("catalog.title")}
        description={t("catalog.description")}
        actions={
          can("product:manage") ? (
            <Button onClick={() => setFormOpen({})}>{t("catalog.newProduct")}</Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Field label={t("common.search")}>
            <Input
              type="search"
              value={q}
              placeholder={t("catalog.searchPlaceholder")}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </Field>
        </div>
        <Button variant="secondary" onClick={() => setScanOpen(true)}>
          {t("common.scan")}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label={t("catalog.filterCategory")}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("catalog.allCategories")}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("catalog.filter")}>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`catalog.filters.${f}`)}
              </option>
            ))}
          </Select>
        </Field>
        <SiteSelect value={siteId} onChange={setSiteId} allowAll />
      </div>

      {list.isLoading ? <ListSkeleton rows={6} /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}
      {list.data ? (
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
                  <Link href={`/stock/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                ),
              },
              { key: "sku", header: t("catalog.columns.sku"), render: (p) => p.sku },
              { key: "brand", header: t("catalog.columns.brand"), render: (p) => p.brand ?? "—" },
              {
                key: "oem",
                header: t("catalog.columns.oem"),
                render: (p) => p.oemReference ?? "—",
              },
              {
                key: "category",
                header: t("catalog.columns.category"),
                render: (p) => p.category ?? "—",
              },
              {
                key: "available",
                header: t("catalog.columns.available"),
                render: (p) =>
                  p.levels.length === 0
                    ? "—"
                    : p.levels
                        .map((l) => `${l.siteCode} ${qtyText(l.available, p.quantityScale)}`)
                        .join(" · "),
              },
              ...(showCost
                ? [
                    {
                      key: "cost",
                      header: t("catalog.columns.cost"),
                      render: (p: (typeof items)[number]) =>
                        p.averageCost != null ? formatFCFA(p.averageCost) : "—",
                    },
                  ]
                : []),
              {
                key: "price",
                header: t("catalog.columns.price"),
                render: (p) => formatFCFA(p.salePrice),
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
            ]}
          />
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t("common.loadMore")}
            </Button>
          ) : null}
        </>
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
