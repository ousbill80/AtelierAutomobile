"use client";

// M07 §7 — /stock/sorties : file du magasin (réservations à sortir, triées par urgence),
// sortie vers l'OR, libération motivée, sortie directe sans réservation et retour d'OR.
import { useMemo, useState } from "react";
import Link from "next/link";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  MapPin,
  PackageCheck,
  PackageOpen,
  Search,
  ShoppingCart,
  Wrench,
} from "lucide-react";
import type { AppRouter } from "@/server/routers/_app";
import {
  Button,
  CheckboxRow,
  EmptyState,
  Input,
  Modal,
  PlateBadge,
  StatusBadge,
} from "@atelieros/ui";
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

type QueueItem = inferRouterOutputs<AppRouter>["stock"]["queue"][number];

type FilterTab = "ALL" | "RESERVED" | "BACKORDERED" | "STALE";

const PRIORITY_TONE: Record<string, "bad" | "warn" | "ok" | "off"> = {
  URGENT: "bad",
  HIGH: "warn",
  NORMAL: "off",
  LOW: "off",
};

export default function StoreQueuePage() {
  const can = useCan();
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useDefaultSite();
  const [issueItem, setIssueItem] = useState<QueueItem | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  const [mode, setMode] = useState<"direct" | "return" | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");

  const queue = trpc.stock.queue.useQuery(
    { siteId: siteId || undefined },
    { enabled: !!siteId, refetchInterval: 30_000 },
  );

  const release = trpc.stock.release.useMutation({
    onSuccess() {
      setReleaseId(null);
      void utils.stock.invalidate();
    },
  });

  const rawItems = useMemo(() => queue.data ?? [], [queue.data]);

  // Statistiques de la file
  const stats = useMemo(() => {
    const toIssue = rawItems.filter((i) => i.status === "RESERVED").length;
    const waiting = rawItems.filter((i) => i.status === "BACKORDERED").length;
    const stale = rawItems.filter((i) => i.stale).length;
    const uniqueOrders = new Set(
      rawItems.map((i) => i.repairOrder?.id).filter((id): id is string => Boolean(id)),
    ).size;
    return { toIssue, waiting, stale, uniqueOrders, total: rawItems.length };
  }, [rawItems]);

  // Filtrage combiné recherche + onglet
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawItems.filter((item) => {
      if (filterTab === "RESERVED" && item.status !== "RESERVED") return false;
      if (filterTab === "BACKORDERED" && item.status !== "BACKORDERED") return false;
      if (filterTab === "STALE" && !item.stale) return false;

      if (q) {
        const matchName = item.product.name.toLowerCase().includes(q);
        const matchSku = item.product.sku.toLowerCase().includes(q);
        const matchRo = item.repairOrder?.number.toLowerCase().includes(q);
        const matchPlate = item.repairOrder?.plate.toLowerCase().includes(q);
        const matchBin = item.binLocation?.toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchRo && !matchPlate && !matchBin) return false;
      }

      return true;
    });
  }, [rawItems, filterTab, search]);

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="stock" />

      <PageTitle
        title={t("queue.title")}
        description={t("queue.description")}
        actions={
          can("stock:issue") ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setMode("direct")}>
                <ArrowUpRight className="mr-1.5 size-4" aria-hidden />
                {t("queue.directIssue")}
              </Button>
              <Button variant="secondary" onClick={() => setMode("return")}>
                <ArrowDownLeft className="mr-1.5 size-4" aria-hidden />
                {t("queue.returnFromRo")}
              </Button>
            </div>
          ) : null
        }
      />

      {/* Barre de site */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <SiteSelect value={siteId} onChange={setSiteId} />
        </div>
        <p className="text-xs text-muted">{t("queue.partRequestsGap")}</p>
      </div>

      {/* Cartes KPI Synthèse */}
      {rawItems.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setFilterTab("RESERVED")}
            className={`flex flex-col gap-1 rounded-xl border p-3.5 text-left transition ${
              filterTab === "RESERVED"
                ? "border-status-ok bg-status-ok/10 shadow-sm"
                : "border-border bg-surface hover:border-status-ok/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-ok">
              <span className="text-xs font-semibold uppercase tracking-wider">
                À sortir magasin
              </span>
              <PackageCheck className="size-4 text-status-ok" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-ok">
              {stats.toIssue}
            </span>
            <span className="text-xs text-muted">Prêtes à être servies</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("BACKORDERED")}
            className={`flex flex-col gap-1 rounded-xl border p-3.5 text-left transition ${
              filterTab === "BACKORDERED"
                ? "border-status-warn bg-status-warn/10 shadow-sm"
                : "border-border bg-surface hover:border-status-warn/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-warn">
              <span className="text-xs font-semibold uppercase tracking-wider">
                En attente appro
              </span>
              <ShoppingCart className="size-4 text-status-warn" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-warn">
              {stats.waiting}
            </span>
            <span className="text-xs text-muted">Stock insuffisant</span>
          </button>

          <button
            type="button"
            onClick={() => setFilterTab("STALE")}
            className={`flex flex-col gap-1 rounded-xl border p-3.5 text-left transition ${
              filterTab === "STALE"
                ? "border-status-bad bg-status-bad/10 shadow-sm"
                : "border-border bg-surface hover:border-status-bad/50"
            }`}
          >
            <div className="flex items-center justify-between text-status-bad">
              <span className="text-xs font-semibold uppercase tracking-wider">
                Réservations dormantes
              </span>
              <Clock className="size-4 text-status-bad" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight text-status-bad">{stats.stale}</span>
            <span className="text-xs text-muted">&gt; 30j ou OR clos</span>
          </button>

          <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3.5 text-left shadow-sm">
            <div className="flex items-center justify-between text-muted">
              <span className="text-xs font-semibold uppercase tracking-wider">
                Ordres concernés
              </span>
              <Wrench className="size-4 text-accent" aria-hidden />
            </div>
            <span className="text-2xl font-bold tracking-tight">{stats.uniqueOrders}</span>
            <span className="text-xs text-muted">{rawItems.length} article(s) au total</span>
          </div>
        </div>
      ) : null}

      {/* Barre d'outils et recherche */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            placeholder="Rechercher article, SKU, N° OR, plaque, rayon…"
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Pilules de filtre */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={() => setFilterTab("ALL")}
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
              filterTab === "ALL"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "border border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            Tous ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("RESERVED")}
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
              filterTab === "RESERVED"
                ? "bg-status-ok text-status-ok-foreground shadow-sm"
                : "border border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            À sortir ({stats.toIssue})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("BACKORDERED")}
            className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
              filterTab === "BACKORDERED"
                ? "bg-status-warn text-status-warn-foreground shadow-sm"
                : "border border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            En attente ({stats.waiting})
          </button>
          {stats.stale > 0 ? (
            <button
              type="button"
              onClick={() => setFilterTab("STALE")}
              className={`rounded-lg px-2.5 py-1.5 font-medium transition ${
                filterTab === "STALE"
                  ? "bg-status-bad text-status-bad-foreground shadow-sm"
                  : "border border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              Dormantes ({stats.stale})
            </button>
          ) : null}
        </div>
      </div>

      {queue.isLoading ? <ListSkeleton rows={4} /> : null}
      {queue.isError ? <ErrorBox onRetry={() => queue.refetch()} /> : null}

      {queue.data && filteredItems.length === 0 ? (
        <EmptyState
          title={
            rawItems.length === 0
              ? t("queue.empty")
              : "Aucune réservation ne correspond aux filtres"
          }
          description={
            rawItems.length === 0
              ? undefined
              : "Modifiez les filtres ou le terme de recherche ci-dessus."
          }
        />
      ) : null}

      {/* Grille des réservations */}
      {filteredItems.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {filteredItems.map((item) => {
            const hasStock = item.onHand >= item.quantity;
            return (
              <li
                key={item.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-accent/40"
                data-testid="queue-item"
              >
                {/* En-tête de la carte */}
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/stock/${item.product.id}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {item.product.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted">
                        <span className="font-mono">{item.product.sku}</span>
                        {item.binLocation ? (
                          <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 font-medium text-foreground">
                            <MapPin className="size-3 text-accent" aria-hidden />
                            {item.binLocation}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.stale ? <StatusBadge tone="bad" label={t("queue.stale")} /> : null}
                      <StatusBadge
                        tone={RESERVATION_TONE[item.status] ?? "off"}
                        label={item.status === "RESERVED" ? t("queue.toIssue") : t("queue.waiting")}
                      />
                    </div>
                  </div>

                  {/* Détail OR / Véhicule rattaché */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.repairOrder ? (
                        <>
                          <Link
                            href={`/ordres/${item.repairOrder.id}`}
                            className="font-semibold text-accent hover:underline"
                          >
                            {item.repairOrder.number}
                          </Link>
                          {item.repairOrder.plate ? (
                            <PlateBadge plate={item.repairOrder.plate} />
                          ) : null}
                          {item.repairOrder.priority && item.repairOrder.priority !== "NORMAL" ? (
                            <StatusBadge
                              tone={PRIORITY_TONE[item.repairOrder.priority] ?? "off"}
                              label={item.repairOrder.priority}
                            />
                          ) : null}
                        </>
                      ) : (
                        <span className="italic text-muted">{t("queue.noRo")}</span>
                      )}
                    </div>
                    <span className="text-muted">{formatDay(item.createdAt)}</span>
                  </div>

                  {/* Stock disponible et quantité demandée */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="text-muted">Quantité requise :</span>
                      <span className="font-semibold text-foreground">
                        {qtyText(item.quantity, item.product.quantityScale, item.product.unit)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-muted">En rayon :</span>
                      <span
                        className={`font-semibold ${
                          hasStock ? "text-status-ok" : "text-status-bad"
                        }`}
                      >
                        {qtyText(item.onHand, item.product.quantityScale, item.product.unit)}
                      </span>
                    </div>
                  </div>

                  {/* Commande fournisseur en attente si présente */}
                  {item.purchaseOrder ? (
                    <div className="flex items-center gap-1.5 text-xs text-status-warn">
                      <ShoppingCart className="size-3.5 shrink-0" aria-hidden />
                      <span>{t("queue.expectedPo", { number: item.purchaseOrder.number })}</span>
                      {item.purchaseOrder.expectedAt ? (
                        <span>(livraison prévue {formatDay(item.purchaseOrder.expectedAt)})</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {item.status === "RESERVED" && can("stock:issue") ? (
                    <Button onClick={() => setIssueItem(item)}>
                      <PackageOpen className="mr-1.5 size-4" aria-hidden />
                      {t("queue.issue")}
                    </Button>
                  ) : null}

                  {can("stock:reserve") ? (
                    <Button variant="ghost" onClick={() => setReleaseId(item.id)}>
                      {t("queue.release")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
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
        <div className="rounded-lg bg-surface-2 p-3">
          <p className="font-semibold text-foreground">{item.product.name}</p>
          <span className="text-xs text-muted">{item.product.sku}</span>
          {item.binLocation ? (
            <span className="ml-2 text-xs font-medium text-accent">Rayon : {item.binLocation}</span>
          ) : null}
        </div>
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
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SiteSelect value={siteId} onChange={setSiteId} />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{t("queue.pickProduct")}</label>
          <ProductPicker onPick={setProduct} />
          {product ? (
            <p className="rounded-lg bg-surface-2 p-2 text-sm font-medium">
              ✓ {product.name} ({product.sku})
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">{t("queue.pickRo")}</label>
          {ro ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-2 text-sm">
              <span className="font-medium">
                {ro.number} · {ro.plate}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setRo(null)}>
                {t("common.change")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <Input
                label={t("queue.roSearch")}
                value={roQuery}
                onChange={(e) => setRoQuery(e.target.value)}
                placeholder="N° d'OR ou plaque…"
              />
              {orders.data && orders.data.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto rounded-lg border border-border bg-surface text-sm">
                  {orders.data.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between p-2 text-left hover:bg-surface-2"
                        onClick={() => {
                          setRo({ id: o.id, number: o.number, plate: o.vehicle.plate });
                          setRoQuery("");
                        }}
                      >
                        <span className="font-medium">{o.number}</span>
                        <PlateBadge plate={o.vehicle.plate} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        <Input
          label={`${t("common.quantity")}${product ? ` (${product.unit})` : ""}`}
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />

        {mode === "return" ? (
          <>
            <CheckboxRow
              label={t("queue.resellable")}
              description={t("queue.resellableHint")}
              checked={resellable}
              onChange={(e) => setResellable(e.target.checked)}
            />
            <Input
              label={t("queue.returnReason")}
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
