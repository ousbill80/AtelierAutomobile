"use client";

// M07 §7 — /stock/sorties : file du magasin (réservations à sortir, triées par urgence),
// sortie vers l'OR, libération motivée, sortie directe sans réservation et retour d'OR.
// Écart : les demandes de pièces des mécaniciens (PartRequest, M06) arriveront avec l'étape 5.2.
import { useState } from "react";
import { Button, CheckboxRow, EmptyState, Input, Modal, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  ProductPicker,
  ReasonModal,
  SiteSelect,
  useCan,
  useDefaultSite,
  type PickedProduct,
} from "../_lib/components";
import { errorMessage, formatDay, qtyText, RESERVATION_TONE, t } from "../_lib/i18n";

type QueueItem = {
  id: string;
  quantity: number;
  product: { id: string; name: string; unit: string; quantityScale: number };
  site: { id: string };
  repairOrder: { id: string; number: string; plate: string } | null;
};

export default function StoreQueuePage() {
  const can = useCan();
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useDefaultSite();
  const [issueItem, setIssueItem] = useState<QueueItem | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [mode, setMode] = useState<"direct" | "return" | null>(null);
  const queue = trpc.stock.queue.useQuery({ siteId: siteId || undefined }, { enabled: !!siteId });
  const release = trpc.stock.release.useMutation({
    onSuccess() {
      setReleaseId(null);
      void utils.stock.invalidate();
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <ModuleNav section="stock" />
      <PageTitle
        title={t("queue.title")}
        description={t("queue.description")}
        actions={
          can("stock:issue") ? (
            <>
              <Button variant="secondary" onClick={() => setMode("direct")}>
                {t("queue.directIssue")}
              </Button>
              <Button variant="secondary" onClick={() => setMode("return")}>
                {t("queue.returnFromRo")}
              </Button>
            </>
          ) : null
        }
      />
      <div className="max-w-xs">
        <SiteSelect value={siteId} onChange={setSiteId} />
      </div>
      <p className="text-xs text-muted">{t("queue.partRequestsGap")}</p>

      {queue.isLoading ? <ListSkeleton /> : null}
      {queue.isError ? <ErrorBox onRetry={() => queue.refetch()} /> : null}
      {queue.data && queue.data.length === 0 ? <EmptyState title={t("queue.empty")} /> : null}
      {queue.data && queue.data.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {queue.data.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
              data-testid="queue-item"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{item.product.name}</div>
                  <div className="text-sm text-muted">
                    {item.product.sku}
                    {item.binLocation ? ` · ${t("queue.bin")} ${item.binLocation}` : ""}
                  </div>
                </div>
                {item.stale ? <StatusBadge tone="bad" label={t("queue.stale")} /> : null}
                <StatusBadge
                  tone={RESERVATION_TONE[item.status] ?? "off"}
                  label={item.status === "RESERVED" ? t("queue.toIssue") : t("queue.waiting")}
                />
              </div>
              <div className="text-sm">
                <span className="font-medium">
                  {qtyText(item.quantity, item.product.quantityScale, item.product.unit)}
                </span>
                {" · "}
                {item.repairOrder
                  ? `${item.repairOrder.number} · ${item.repairOrder.plate}`
                  : t("queue.noRo")}
                {" · "}
                <span className="text-muted">{formatDay(item.createdAt)}</span>
              </div>
              <div className="text-xs text-muted">
                {t("queue.inStock", { qty: qtyText(item.onHand, item.product.quantityScale) })}
                {item.purchaseOrder
                  ? ` · ${t("queue.expectedPo", { number: item.purchaseOrder.number })}`
                  : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === "RESERVED" && can("stock:issue") ? (
                  <Button onClick={() => setIssueItem(item)}>{t("queue.issue")}</Button>
                ) : null}
                {can("stock:reserve") ? (
                  <Button variant="ghost" onClick={() => setReleaseId(item.id)}>
                    {t("queue.release")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {issueItem ? <IssueModal item={issueItem} onClose={() => setIssueItem(null)} /> : null}
      <ReasonModal
        open={releaseId !== null}
        title={t("queue.releaseTitle")}
        submitLabel={t("queue.release")}
        pending={release.isPending}
        error={release.error ? errorMessage(release.error) : null}
        onClose={() => setReleaseId(null)}
        onSubmit={(reason) => releaseId && release.mutate({ reservationId: releaseId, reason })}
      />
      {mode ? <DirectModal mode={mode} siteId={siteId} onClose={() => setMode(null)} /> : null}
    </div>
  );
}

function IssueModal({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const utils = trpc.useUtils();
  const scale = item.product.quantityScale;
  const [quantity, setQuantity] = useState(String(item.quantity / scale).replace(".", ","));
  const issue = trpc.stock.issue.useMutation({
    onSuccess() {
      void utils.stock.invalidate();
      void utils.product.invalidate();
      onClose();
    },
  });
  const qty = Number(quantity.replace(",", "."));
  return (
    <Modal
      open
      title={t("queue.issueTitle", { number: item.repairOrder?.number ?? t("queue.noRo") })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={issue.isPending}
            disabled={!(qty > 0) || issue.isPending}
            onClick={() =>
              issue.mutate({
                reservationId: item.id,
                productId: item.product.id,
                siteId: item.site.id,
                quantity: qty,
                repairOrderId: item.repairOrder?.id ?? null,
              })
            }
          >
            {t("queue.issueSubmit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{item.product.name}</p>
        <Input
          label={`${t("common.quantity")} (${item.product.unit})`}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <InlineError message={issue.error ? errorMessage(issue.error) : null} />
      </div>
    </Modal>
  );
}

/** Sortie directe (pièce ajoutée en cours de travaux) ou retour d'une pièce non utilisée. */
function DirectModal({
  mode,
  siteId: initialSite,
  onClose,
}: {
  mode: "direct" | "return";
  siteId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useState(initialSite);
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [roQuery, setRoQuery] = useState("");
  const [ro, setRo] = useState<{ id: string; number: string; plate: string } | null>(null);
  const [resellable, setResellable] = useState(true);
  const [reason, setReason] = useState("");
  const orders = trpc.stock.findRepairOrders.useQuery(
    { q: roQuery.trim() },
    { enabled: roQuery.trim().length >= 2 && !ro },
  );
  const done = () => {
    void utils.stock.invalidate();
    void utils.product.invalidate();
    onClose();
  };
  const issue = trpc.stock.issue.useMutation({ onSuccess: done });
  const back = trpc.stock.returnFromRo.useMutation({ onSuccess: done });
  const pending = issue.isPending || back.isPending;
  const error = issue.error ?? back.error;
  const qty = Number(quantity.replace(",", "."));

  function submit() {
    if (!product || !ro) return;
    if (mode === "direct") {
      issue.mutate({ productId: product.id, siteId, quantity: qty, repairOrderId: ro.id });
    } else {
      back.mutate({
        productId: product.id,
        siteId,
        quantity: qty,
        repairOrderId: ro.id,
        resellable,
        reason: reason || null,
      });
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={mode === "direct" ? t("queue.directIssueTitle") : t("queue.returnTitle")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={pending}
            disabled={!product || !ro || !(qty > 0) || pending}
            onClick={submit}
          >
            {mode === "direct" ? t("queue.issueSubmit") : t("queue.returnSubmit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SiteSelect value={siteId} onChange={setSiteId} />
        {product ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-2 text-sm">
            <span>
              {product.name} · {product.sku}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>
              {t("common.edit")}
            </Button>
          </div>
        ) : (
          <ProductPicker onPick={setProduct} />
        )}
        <Input
          label={`${t("common.quantity")}${product ? ` (${product.unit})` : ""}`}
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
            {orders.data?.map((o) => (
              <button
                key={o.id}
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-left text-sm hover:bg-surface-2"
                onClick={() => setRo({ id: o.id, number: o.number, plate: o.vehicle.plate })}
              >
                {o.number} · {o.vehicle.plate}
              </button>
            ))}
            {orders.data && orders.data.length === 0 ? (
              <p className="text-sm text-muted">{t("reserve.noResult")}</p>
            ) : null}
          </>
        )}
        {mode === "return" ? (
          <>
            <CheckboxRow
              label={t("queue.resellable")}
              checked={resellable}
              onChange={(e) => setResellable(e.target.checked)}
            />
            <Input
              label={`${t("common.reason")} ${t("common.optional")}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        ) : null}
        <InlineError message={error ? errorMessage(error) : null} />
      </div>
    </Modal>
  );
}
