"use client";

// M07 §7 — /stock/[id] : références, compatibilités, prix et marge, niveaux par site et
// emplacement, réservations, historique des mouvements, fournisseurs et derniers prix.
// Actions : modifier, ajuster (motif), réserver pour un OR, seuils, archiver, étiquette.
import { useState } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  SiteSelect,
  useCan,
  useDefaultSite,
} from "../_lib/components";
import {
  errorMessage,
  formatDateTime,
  formatDay,
  qtyText,
  RESERVATION_TONE,
  t,
} from "../_lib/i18n";
import { emptyProduct, ProductFormModal } from "../_lib/product-form";

type Tab = "info" | "stock" | "reservations" | "movements" | "suppliers";
const REASON_CODES = ["casse", "perte", "vol", "peremption", "demonte", "erreur", "autre"] as const;

export function ProductView({ id }: { id: string }) {
  const can = useCan();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("stock");
  const [dialog, setDialog] = useState<"edit" | "adjust" | "reserve" | "label" | "archive" | null>(
    null,
  );
  const [levelSite, setLevelSite] = useState<string | null>(null);
  const query = trpc.product.get.useQuery({ id });
  const archive = trpc.product.archive.useMutation({
    onSuccess() {
      setDialog(null);
      void utils.product.invalidate();
    },
  });

  if (query.isLoading) return <ListSkeleton rows={5} />;
  if (query.isError || !query.data) {
    return (
      <ErrorBox
        message={query.error?.data?.code === "NOT_FOUND" ? t("product.notFound") : undefined}
        onRetry={() => query.refetch()}
      />
    );
  }
  const { product, reservations, movements, suppliers, canSeeCost } = query.data;
  const level = product.levels.find((l) => l.siteId === levelSite) ?? null;

  return (
    <div className="flex flex-col gap-4 pb-10">
      <ModuleNav section="stock" />
      <Link href="/stock" className="min-h-11 text-sm text-muted underline">
        {t("common.back")}
      </Link>
      <PageTitle
        title={product.name}
        description={`${product.sku}${product.brand ? ` · ${product.brand}` : ""}`}
        actions={
          <>
            {can("product:manage") ? (
              <Button variant="secondary" onClick={() => setDialog("edit")}>
                {t("common.edit")}
              </Button>
            ) : null}
            {can("stock:reserve") && product.isActive ? (
              <Button variant="secondary" onClick={() => setDialog("reserve")}>
                {t("product.actions.reserve")}
              </Button>
            ) : null}
            {can("stock:adjust") ? (
              <Button variant="secondary" onClick={() => setDialog("adjust")}>
                {t("product.actions.adjust")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setDialog("label")}>
              {t("product.actions.label")}
            </Button>
            {can("product:manage") ? (
              product.isActive ? (
                <Button variant="ghost" onClick={() => setDialog("archive")}>
                  {t("product.actions.archive")}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => archive.mutate({ id, archived: false })}>
                  {t("product.actions.restore")}
                </Button>
              )
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        {!product.isActive ? <StatusBadge tone="off" label={t("catalog.archived")} /> : null}
        {product.negative ? <StatusBadge tone="bad" label={t("catalog.alertNegative")} /> : null}
        {product.belowMin ? <StatusBadge tone="warn" label={t("catalog.alertBelowMin")} /> : null}
      </div>
      <InlineError message={archive.error ? errorMessage(archive.error) : null} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={t("product.levels")}>
        <Kpi
          label={t("product.level.onHand")}
          value={qtyText(product.totalOnHand, product.quantityScale, product.unit)}
        />
        <Kpi
          label={t("product.level.available")}
          value={qtyText(product.totalAvailable, product.quantityScale, product.unit)}
        />
        <Kpi label={t("catalog.columns.price")} value={formatFCFA(product.salePrice)} />
        {canSeeCost && product.averageCost != null ? (
          <Kpi
            label={t("product.averageCost")}
            value={formatFCFA(product.averageCost)}
            testId="average-cost"
          />
        ) : null}
      </section>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as Tab)}
        items={(["stock", "info", "reservations", "movements", "suppliers"] as const).map((k) => ({
          key: k,
          label: t(`product.tabs.${k}`),
        }))}
      />

      {tab === "info" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-2 font-semibold">{t("product.references")}</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">{t("product.sku")}</dt>
              <dd>{product.sku}</dd>
              <dt className="text-muted">{t("product.oemReference")}</dt>
              <dd>{product.oemReference ?? "—"}</dd>
              <dt className="text-muted">{t("product.barcode")}</dt>
              <dd className="break-all">{product.barcode ?? "—"}</dd>
              <dt className="text-muted">{t("product.category")}</dt>
              <dd>{product.category ?? "—"}</dd>
              <dt className="text-muted">{t("product.unit")}</dt>
              <dd>{product.unit}</dd>
              <dt className="text-muted">{t("product.packSize")}</dt>
              <dd>{product.packSize}</dd>
              <dt className="text-muted">{t("product.crossReferences")}</dt>
              <dd className="break-words">{product.crossReferences.join(", ") || "—"}</dd>
              <dt className="text-muted">{t("product.defaultSupplier")}</dt>
              <dd>{product.defaultSupplier?.name ?? "—"}</dd>
              <dt className="text-muted">{t("product.lastIssuedAt")}</dt>
              <dd>{formatDay(product.lastIssuedAt)}</dd>
            </dl>
          </section>
          <section className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-2 font-semibold">{t("product.prices")}</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">{t("product.salePrice")}</dt>
              <dd>{formatFCFA(product.salePrice)}</dd>
              <dt className="text-muted">{t("product.minSalePrice")}</dt>
              <dd>{product.minSalePrice != null ? formatFCFA(product.minSalePrice) : "—"}</dd>
              {canSeeCost ? (
                <>
                  <dt className="text-muted">{t("product.averageCost")}</dt>
                  <dd>{product.averageCost != null ? formatFCFA(product.averageCost) : "—"}</dd>
                  <dt className="text-muted">{t("product.purchasePrice")}</dt>
                  <dd>{product.purchasePrice != null ? formatFCFA(product.purchasePrice) : "—"}</dd>
                  <dt className="text-muted">{t("product.margin")}</dt>
                  <dd>{product.marginRate != null ? `${product.marginRate} %` : "—"}</dd>
                </>
              ) : null}
            </dl>
            <h2 className="mb-2 mt-4 font-semibold">{t("product.compatibility")}</h2>
            {product.compatibleWith.length === 0 ? (
              <p className="text-sm text-muted">{t("product.compatNone")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-sm">
                {product.compatibleWith.map((c) => (
                  <li key={c} className="rounded-md bg-surface-2 px-2 py-1">
                    {c.replace(/\|/g, " · ")}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {tab === "stock" ? (
        <DataTable
          rows={product.levels}
          rowKey={(l) => l.id}
          empty={<EmptyState title={t("product.noMovements")} />}
          columns={[
            { key: "site", header: t("common.site"), primary: true, render: (l) => l.siteName },
            {
              key: "onHand",
              header: t("product.level.onHand"),
              render: (l) => qtyText(l.onHand, product.quantityScale),
            },
            {
              key: "reserved",
              header: t("product.level.reserved"),
              render: (l) => qtyText(l.reserved, product.quantityScale),
            },
            {
              key: "available",
              header: t("product.level.available"),
              render: (l) => (
                <span
                  className="flex flex-wrap items-center gap-2"
                  data-testid={`available-${l.siteCode}`}
                >
                  {qtyText(l.available, product.quantityScale)}
                  {l.onHand < 0 ? (
                    <StatusBadge tone="bad" label={t("catalog.alertNegative")} />
                  ) : null}
                  {l.onHand >= 0 && l.belowMin ? (
                    <StatusBadge tone="warn" label={t("catalog.alertBelowMin")} />
                  ) : null}
                </span>
              ),
            },
            {
              key: "min",
              header: t("product.level.min"),
              render: (l) => qtyText(l.minStock, product.quantityScale),
            },
            {
              key: "max",
              header: t("product.level.max"),
              render: (l) =>
                l.maxStock != null ? qtyText(l.maxStock, product.quantityScale) : "—",
            },
            { key: "bin", header: t("product.level.bin"), render: (l) => l.binLocation ?? "—" },
            ...(can("product:manage")
              ? [
                  {
                    key: "edit",
                    header: "",
                    render: (l: (typeof product.levels)[number]) => (
                      <Button size="sm" variant="ghost" onClick={() => setLevelSite(l.siteId)}>
                        {t("product.level.edit")}
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : null}

      {tab === "reservations" ? (
        <DataTable
          rows={reservations}
          rowKey={(r) => r.id}
          empty={<EmptyState title={t("product.noReservations")} />}
          columns={[
            {
              key: "ro",
              header: t("reserve.repairOrder"),
              primary: true,
              render: (r) =>
                r.repairOrderNumber ? `${r.repairOrderNumber} · ${r.plate ?? ""}` : t("queue.noRo"),
            },
            { key: "site", header: t("common.site"), render: (r) => r.siteCode },
            {
              key: "qty",
              header: t("common.quantity"),
              render: (r) => qtyText(r.quantity, product.quantityScale, product.unit),
            },
            {
              key: "status",
              header: t("common.status"),
              render: (r) => (
                <StatusBadge
                  tone={RESERVATION_TONE[r.status] ?? "off"}
                  label={t(`reservationStatus.${r.status}`)}
                />
              ),
            },
            { key: "date", header: t("common.date"), render: (r) => formatDay(r.createdAt) },
          ]}
        />
      ) : null}

      {tab === "movements" ? (
        <DataTable
          rows={movements}
          rowKey={(m) => m.id}
          empty={<EmptyState title={t("product.noMovements")} />}
          columns={[
            {
              key: "type",
              header: t("movements.columns.type"),
              primary: true,
              render: (m) => t(`movementTypes.${m.type}`),
            },
            {
              key: "date",
              header: t("movements.columns.date"),
              render: (m) => formatDateTime(m.createdAt),
            },
            { key: "site", header: t("movements.columns.site"), render: (m) => m.siteCode },
            {
              key: "qty",
              header: t("movements.columns.qty"),
              render: (m) => (
                <span className={m.quantity < 0 ? "text-status-bad" : "text-status-ok"}>
                  {m.quantity > 0 ? "+" : ""}
                  {qtyText(m.quantity, product.quantityScale)}
                </span>
              ),
            },
            ...(canSeeCost
              ? [
                  {
                    key: "cost",
                    header: t("movements.columns.cost"),
                    render: (m: (typeof movements)[number]) =>
                      m.unitCost != null ? formatFCFA(m.unitCost) : "—",
                  },
                ]
              : []),
            {
              key: "doc",
              header: t("movements.columns.document"),
              render: (m) => m.repairOrderNumber ?? m.purchaseOrderNumber ?? "—",
            },
            {
              key: "reason",
              header: t("movements.columns.reason"),
              render: (m) =>
                [m.reasonCode ? t(`adjust.codes.${m.reasonCode}`) : null, m.reason]
                  .filter(Boolean)
                  .join(" — ") || "—",
            },
          ]}
        />
      ) : null}

      {tab === "suppliers" ? (
        <DataTable
          rows={suppliers}
          rowKey={(s) => s.supplierId}
          empty={<EmptyState title={t("product.noSuppliers")} />}
          columns={[
            {
              key: "name",
              header: t("purchases.supplier"),
              primary: true,
              render: (s) => (
                <Link
                  href={`/achats/fournisseurs/${s.supplierId}`}
                  className="font-medium hover:underline"
                >
                  {s.name}
                </Link>
              ),
            },
            {
              key: "cost",
              header: t("product.supplierLastCost"),
              render: (s) => (s.lastCost != null ? formatFCFA(s.lastCost) : "—"),
            },
            {
              key: "date",
              header: t("product.supplierLastOrder"),
              render: (s) => `${s.number} · ${formatDay(s.lastOrderAt)}`,
            },
          ]}
        />
      ) : null}

      {dialog === "edit" ? (
        <ProductFormModal
          open
          initial={emptyProduct({
            id: product.id,
            sku: product.sku,
            name: product.name,
            brand: product.brand ?? "",
            oemReference: product.oemReference ?? "",
            barcode: product.barcode ?? "",
            category: product.category ?? "",
            unit: product.unit as never,
            salePrice: product.salePrice,
            minSalePrice: product.minSalePrice,
            vatRate: product.vatRate,
            minStock: product.minStock,
            reorderQty: product.reorderQty,
            packSize: product.packSize,
            isStocked: product.isStocked,
            crossReferences: product.crossReferences.join(", "),
            compatibleWith: product.compatibleWith,
            defaultSupplierId: product.defaultSupplier?.id ?? "",
          })}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
      {dialog === "adjust" ? (
        <AdjustModal productId={product.id} unit={product.unit} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "reserve" ? (
        <ReserveModal
          productId={product.id}
          unit={product.unit}
          scale={product.quantityScale}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {level ? (
        <LevelModal
          productId={product.id}
          siteId={level.siteId}
          siteName={level.siteName}
          scale={product.quantityScale}
          initial={level}
          onClose={() => setLevelSite(null)}
        />
      ) : null}
      <Modal
        open={dialog === "archive"}
        title={t("product.actions.archive")}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={archive.isPending}
              onClick={() => archive.mutate({ id, archived: true })}
            >
              {t("product.actions.archive")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("product.archiveConfirm")}</p>
        <InlineError message={archive.error ? errorMessage(archive.error) : null} />
      </Modal>
      <Modal
        open={dialog === "label"}
        title={t("label.title", { sku: product.sku })}
        onClose={() => setDialog(null)}
        footer={<Button onClick={() => window.print()}>{t("label.print")}</Button>}
      >
        <div className="print-label mx-auto flex w-64 flex-col items-center gap-1 rounded-md border border-border p-3 text-center">
          <span className="font-semibold">{product.name}</span>
          <span className="text-sm">{product.sku}</span>
          <span className="font-mono text-lg tracking-widest">
            {product.barcode ?? product.sku}
          </span>
          <span className="text-sm">{formatFCFA(product.salePrice)} HT</span>
        </div>
      </Modal>
    </div>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

function AdjustModal({
  productId,
  unit,
  onClose,
}: {
  productId: string;
  unit: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useDefaultSite();
  const [quantity, setQuantity] = useState("");
  const [reasonCode, setReasonCode] = useState<(typeof REASON_CODES)[number]>("casse");
  const [reason, setReason] = useState("");
  const adjust = trpc.stock.adjust.useMutation({
    onSuccess() {
      void utils.product.invalidate();
      void utils.stock.invalidate();
      onClose();
    },
  });
  const qty = Number(quantity.replace(",", ".").replace("−", "-"));
  return (
    <Modal
      open
      title={t("adjust.title")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={adjust.isPending}
            disabled={!siteId || !qty || reason.trim().length < 3 || adjust.isPending}
            onClick={() =>
              adjust.mutate({ siteId, productId, quantity: qty, reasonCode, reason: reason.trim() })
            }
          >
            {t("adjust.submit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SiteSelect value={siteId} onChange={setSiteId} />
        <Input
          label={`${t("common.quantity")} (${unit})`}
          hint={t("adjust.quantityHint")}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Field label={t("adjust.reasonCode")}>
          <Select
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
          >
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {t(`adjust.codes.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.reason")}>
          <Textarea
            value={reason}
            placeholder={t("common.reasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <InlineError message={adjust.error ? errorMessage(adjust.error) : null} />
      </div>
    </Modal>
  );
}

export function ReserveModal({
  productId,
  unit,
  scale,
  onClose,
}: {
  productId: string;
  unit: string;
  scale: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useDefaultSite();
  const [quantity, setQuantity] = useState("1");
  const [roQuery, setRoQuery] = useState("");
  const [ro, setRo] = useState<{ id: string; number: string; plate: string } | null>(null);
  const [result, setResult] = useState<string[] | null>(null);
  const orders = trpc.stock.findRepairOrders.useQuery(
    { q: roQuery.trim() },
    { enabled: roQuery.trim().length >= 2 && !ro },
  );
  const reserve = trpc.stock.reserve.useMutation({
    onSuccess(r) {
      void utils.product.invalidate();
      void utils.stock.invalidate();
      const lines: string[] = [];
      if (r.reserved > 0) lines.push(t("reserve.reserved", { qty: qtyText(r.reserved, scale) }));
      if (r.backordered > 0) {
        lines.push(t("reserve.backordered", { qty: qtyText(r.backordered, scale) }));
      }
      if (r.lastReservedBy) lines.push(t("reserve.lastReservedBy", { number: r.lastReservedBy }));
      setResult(lines);
    },
  });
  const qty = Number(quantity.replace(",", "."));
  return (
    <Modal
      open
      title={t("reserve.title")}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>{t("common.close")}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={reserve.isPending}
              disabled={!siteId || !ro || !(qty > 0) || reserve.isPending}
              onClick={() =>
                ro && reserve.mutate({ productId, siteId, quantity: qty, repairOrderId: ro.id })
              }
            >
              {t("reserve.submit")}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ul className="flex flex-col gap-1 text-sm" role="status">
          {result.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-3">
          <SiteSelect value={siteId} onChange={setSiteId} />
          <Input
            label={`${t("common.quantity")} (${unit})`}
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          {ro ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-2 text-sm">
              <span>{t("reserve.selected", { number: ro.number, plate: ro.plate })}</span>
              <Button size="sm" variant="ghost" onClick={() => setRo(null)}>
                {t("common.edit")}
              </Button>
            </div>
          ) : (
            <>
              <Input
                label={t("reserve.repairOrder")}
                placeholder={t("reserve.repairOrderPlaceholder")}
                value={roQuery}
                onChange={(e) => setRoQuery(e.target.value)}
              />
              {orders.data ? (
                orders.data.length === 0 ? (
                  <p className="text-sm text-muted">{t("reserve.noResult")}</p>
                ) : (
                  <ul className="flex flex-col rounded-md border border-border">
                    {orders.data.map((o) => (
                      <li key={o.id}>
                        <button
                          type="button"
                          className="min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                          onClick={() => {
                            setRo({ id: o.id, number: o.number, plate: o.vehicle.plate });
                            if (o.siteId) setSiteId(o.siteId);
                          }}
                        >
                          {o.number} · {o.vehicle.plate}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
          <InlineError message={reserve.error ? errorMessage(reserve.error) : null} />
        </div>
      )}
    </Modal>
  );
}

function LevelModal({
  productId,
  siteId,
  siteName,
  scale,
  initial,
  onClose,
}: {
  productId: string;
  siteId: string;
  siteName: string;
  scale: number;
  initial: { minStock: number; maxStock: number | null; binLocation: string | null };
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [min, setMin] = useState(String(initial.minStock / scale));
  const [max, setMax] = useState(initial.maxStock != null ? String(initial.maxStock / scale) : "");
  const [bin, setBin] = useState(initial.binLocation ?? "");
  const save = trpc.product.setLevelSettings.useMutation({
    onSuccess() {
      void utils.product.invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open
      title={t("product.levelTitle", { site: siteName })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                productId,
                siteId,
                minStock: min === "" ? null : Number(min.replace(",", ".")),
                maxStock: max === "" ? null : Number(max.replace(",", ".")),
                binLocation: bin || null,
              })
            }
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label={t("product.level.min")}
          inputMode="decimal"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <Input
          label={t("product.level.max")}
          inputMode="decimal"
          value={max}
          onChange={(e) => setMax(e.target.value)}
        />
        <Input
          label={t("product.level.bin")}
          value={bin}
          onChange={(e) => setBin(e.target.value)}
        />
        <InlineError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </Modal>
  );
}
