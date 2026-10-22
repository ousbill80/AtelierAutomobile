"use client";

// M07 §7 — /stock/transferts : transferts entre sites par statut ; créer, expédier
// (TRANSFER_OUT), réceptionner (TRANSFER_IN, écart à justifier), annuler un brouillon.
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Package,
  Plus,
  RotateCcw,
  Search,
  Send,
  Truck,
  X,
} from "lucide-react";
import type { AppRouter } from "@/server/routers/_app";
import { Button, EmptyState, Input, Modal, Select, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  ErrorBox,
  InlineError,
  ListSkeleton,
  ModuleNav,
  PageTitle,
  ProductPicker,
  SiteSelect,
  useCan,
  useDefaultSite,
  useMe,
  type PickedProduct,
} from "../_lib/components";
import { errorMessage, formatDay, qtyText, t, TRANSFER_TONE } from "../_lib/i18n";

type Transfer = inferRouterOutputs<AppRouter>["stockTransfer"]["list"][number];

export default function TransfersPage() {
  const can = useCan();
  const utils = trpc.useUtils();
  const list = trpc.stockTransfer.list.useQuery({});
  const items = useMemo(() => list.data ?? [], [list.data]);

  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const [shortfallInfo, setShortfallInfo] = useState<Transfer | null>(null);

  // Filtres
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [fromSiteFilter, setFromSiteFilter] = useState<string>("");
  const [toSiteFilter, setToSiteFilter] = useState<string>("");
  const [onlyShortfall, setOnlyShortfall] = useState(false);

  const refresh = () => {
    void utils.stockTransfer.invalidate();
    void utils.product.invalidate();
  };

  const ship = trpc.stockTransfer.ship.useMutation({ onSuccess: refresh });
  const cancel = trpc.stockTransfer.cancel.useMutation({ onSuccess: refresh });
  const error = ship.error ?? cancel.error;

  // Calcul des KPIs
  const stats = useMemo(() => {
    let inTransit = 0;
    let shortfallCount = 0;
    let completed = 0;
    let totalPieces = 0;

    for (const tr of items) {
      if (tr.status === "IN_TRANSIT") {
        inTransit += 1;
      }
      if (tr.status === "RECEIVED") {
        completed += 1;
        const hasAnomaly = tr.lines.some((l) => l.receivedQty !== l.quantity);
        if (hasAnomaly) {
          shortfallCount += 1;
        }
      }

      for (const l of tr.lines) {
        totalPieces += Math.round(l.quantity / l.product.quantityScale);
      }
    }

    return {
      inTransit,
      shortfallCount,
      completed,
      totalPieces,
    };
  }, [items]);

  // Filtrage
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((tr) => {
      if (statusFilter !== "ALL" && tr.status !== statusFilter) {
        return false;
      }
      if (onlyShortfall) {
        if (tr.status !== "RECEIVED") return false;
        const hasShortfall = tr.lines.some((l) => l.receivedQty !== l.quantity);
        if (!hasShortfall) return false;
      }
      if (
        fromSiteFilter &&
        tr.fromSite.code !== fromSiteFilter &&
        tr.fromSite.name !== fromSiteFilter
      ) {
        return false;
      }
      if (toSiteFilter && tr.toSite.code !== toSiteFilter && tr.toSite.name !== toSiteFilter) {
        return false;
      }
      if (!q) return true;

      const numberMatch = tr.number.toLowerCase().includes(q);
      const siteMatch =
        tr.fromSite.name.toLowerCase().includes(q) ||
        tr.fromSite.code.toLowerCase().includes(q) ||
        tr.toSite.name.toLowerCase().includes(q) ||
        tr.toSite.code.toLowerCase().includes(q);
      const productMatch = tr.lines.some(
        (l) => l.product.name.toLowerCase().includes(q) || l.product.sku.toLowerCase().includes(q),
      );

      return numberMatch || siteMatch || productMatch;
    });
  }, [items, search, statusFilter, onlyShortfall, fromSiteFilter, toSiteFilter]);

  const hasActiveFilters =
    search.length > 0 ||
    statusFilter !== "ALL" ||
    onlyShortfall ||
    fromSiteFilter !== "" ||
    toSiteFilter !== "";

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("ALL");
    setFromSiteFilter("");
    setToSiteFilter("");
    setOnlyShortfall(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <ModuleNav section="stock" />

      {/* Titre et action de création */}
      <PageTitle
        title={t("transfers.title")}
        description={t("transfers.subtitle")}
        actions={
          can("stock:transfer") ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-1.5 size-4" aria-hidden />
              {t("transfers.new")}
            </Button>
          ) : null
        }
      />

      <InlineError message={error ? errorMessage(error) : null} />

      {/* 4 Cartes KPIs interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* En transit */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("IN_TRANSIT");
            setOnlyShortfall(false);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "IN_TRANSIT" && !onlyShortfall
              ? "border-status-warn bg-status-warn-bg/20 ring-1 ring-status-warn"
              : "border-border bg-surface hover:border-status-warn/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("transfers.kpis.inTransit")}
            </span>
            <Truck className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.inTransit}
          </div>
          <span className="mt-1 text-xs text-muted">{t("transfers.kpis.inTransitHint")}</span>
        </button>

        {/* Reçus avec anomalie / écart */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("RECEIVED");
            setOnlyShortfall(true);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            onlyShortfall
              ? "border-status-bad bg-status-bad-bg/20 ring-1 ring-status-bad"
              : "border-border bg-surface hover:border-status-bad/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("transfers.kpis.shortfall")}
            </span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.shortfallCount}
          </div>
          <span className="mt-1 text-xs text-muted">{t("transfers.kpis.shortfallHint")}</span>
        </button>

        {/* Finalisés */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter("RECEIVED");
            setOnlyShortfall(false);
          }}
          className={`flex flex-col justify-between rounded-xl border p-4 text-left transition ${
            statusFilter === "RECEIVED" && !onlyShortfall
              ? "border-status-ok bg-status-ok-bg/20 ring-1 ring-status-ok"
              : "border-border bg-surface hover:border-status-ok/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-ok">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("transfers.kpis.completed")}
            </span>
            <CheckCircle2 className="size-4" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.completed}
          </div>
          <span className="mt-1 text-xs text-muted">{t("transfers.kpis.completedHint")}</span>
        </button>

        {/* Total pièces transférées */}
        <button
          type="button"
          onClick={() => resetFilters()}
          className="flex flex-col justify-between rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent/40"
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider">
              {t("transfers.kpis.totalParts")}
            </span>
            <Package className="size-4 text-accent" aria-hidden />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.totalPieces}
          </div>
          <span className="mt-1 text-xs text-muted">{t("transfers.kpis.totalPartsHint")}</span>
        </button>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("transfers.filters.searchPlaceholder")}
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

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setOnlyShortfall(false);
              }}
              className="h-10 text-xs"
            >
              <option value="ALL">{t("transfers.filters.allStatuses")}</option>
              <option value="DRAFT">{t("transfers.status.DRAFT")}</option>
              <option value="IN_TRANSIT">{t("transfers.status.IN_TRANSIT")}</option>
              <option value="RECEIVED">{t("transfers.status.RECEIVED")}</option>
              <option value="CANCELLED">{t("transfers.status.CANCELLED")}</option>
            </Select>

            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10 text-xs">
                <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                {t("transfers.filters.reset")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {list.isLoading ? <ListSkeleton rows={4} /> : null}
      {list.isError ? <ErrorBox onRetry={() => list.refetch()} /> : null}

      {/* Liste des transferts ou empty states */}
      {list.data ? (
        filteredItems.length === 0 ? (
          items.length === 0 ? (
            <EmptyState
              title={t("transfers.empty")}
              description={t("transfers.subtitle")}
              action={
                can("stock:transfer") ? (
                  <Button onClick={() => setCreating(true)}>
                    <Plus className="mr-1.5 size-4" aria-hidden />
                    {t("transfers.new")}
                  </Button>
                ) : null
              }
            />
          ) : (
            <EmptyState
              title={t("transfers.emptyFiltered")}
              description={t("transfers.emptyFilteredHint")}
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  <RotateCcw className="mr-1.5 size-3.5" aria-hidden />
                  {t("transfers.filters.reset")}
                </Button>
              }
            />
          )
        ) : (
          <ul className="flex flex-col gap-3.5">
            {filteredItems.map((tr) => {
              const hasAnomaly =
                tr.status === "RECEIVED" && tr.lines.some((l) => l.receivedQty !== l.quantity);

              return (
                <li
                  key={tr.id}
                  className={`flex flex-col gap-3 rounded-xl border bg-surface p-4 shadow-sm transition ${
                    hasAnomaly
                      ? "border-status-bad/40 bg-status-bad-bg/5"
                      : "border-border hover:border-accent/30"
                  }`}
                >
                  {/* Ligne d'en-tête du transfert */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="rounded bg-surface-2 px-2.5 py-1 font-mono text-xs font-semibold text-foreground">
                        {tr.number}
                      </span>

                      {/* Badge de trajet Site A -> Site B */}
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-foreground">
                        <span className="font-semibold text-accent">{tr.fromSite.name}</span>
                        <ArrowRight className="size-3.5 text-muted shrink-0" aria-hidden />
                        <span className="font-semibold text-foreground">{tr.toSite.name}</span>
                      </span>

                      <span className="inline-flex items-center gap-1 text-xs text-muted">
                        <Clock className="size-3.5 shrink-0" aria-hidden />
                        {formatDay(tr.shippedAt ?? tr.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasAnomaly ? (
                        <button
                          type="button"
                          onClick={() => setShortfallInfo(tr)}
                          className="inline-flex items-center gap-1 rounded-md bg-status-bad-bg px-2 py-0.5 text-xs font-semibold text-status-bad hover:underline"
                        >
                          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                          <span>{t("transfers.shortfallWarning")}</span>
                        </button>
                      ) : null}

                      <StatusBadge
                        tone={TRANSFER_TONE[tr.status] ?? "off"}
                        label={t(`transfers.status.${tr.status}`)}
                      />
                    </div>
                  </div>

                  {/* Tableau des articles transférés */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border/40 text-muted">
                          <th className="pb-1.5 font-medium">{t("common.product")}</th>
                          <th className="pb-1.5 font-medium">{t("catalog.columns.sku")}</th>
                          <th className="pb-1.5 text-right font-medium">{t("transfers.lines")}</th>
                          {tr.status === "RECEIVED" ? (
                            <th className="pb-1.5 text-right font-medium">
                              {t("transfers.receivedQty")}
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/20">
                        {tr.lines.map((l) => {
                          const isShortfall =
                            tr.status === "RECEIVED" && l.receivedQty !== l.quantity;

                          return (
                            <tr key={l.id} className="hover:bg-surface-2/40">
                              <td className="py-2 font-medium text-foreground">{l.product.name}</td>
                              <td className="py-2 text-muted">{l.product.sku}</td>
                              <td className="py-2 text-right">
                                {qtyText(l.quantity, l.product.quantityScale, l.product.unit)}
                              </td>
                              {tr.status === "RECEIVED" ? (
                                <td className="py-2 text-right">
                                  {isShortfall ? (
                                    <span className="font-semibold text-status-bad">
                                      {qtyText(
                                        l.receivedQty,
                                        l.product.quantityScale,
                                        l.product.unit,
                                      )}{" "}
                                      (
                                      {t("transfers.shortfall", {
                                        qty: qtyText(
                                          l.quantity - l.receivedQty,
                                          l.product.quantityScale,
                                        ),
                                      })}
                                      )
                                    </span>
                                  ) : (
                                    <span className="text-status-ok font-medium">
                                      {qtyText(
                                        l.receivedQty,
                                        l.product.quantityScale,
                                        l.product.unit,
                                      )}
                                    </span>
                                  )}
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Actions directes contextuelles */}
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-2.5">
                    {hasAnomaly ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShortfallInfo(tr)}
                        className="h-9 text-xs text-status-bad hover:bg-status-bad-bg/30"
                      >
                        <AlertTriangle className="mr-1.5 size-3.5" aria-hidden />
                        {t("transfers.shortfallDetails")}
                      </Button>
                    ) : null}

                    {tr.status === "DRAFT" && can("stock:transfer") ? (
                      <>
                        <Button
                          size="sm"
                          loading={ship.isPending}
                          onClick={() => ship.mutate({ id: tr.id })}
                          className="h-9 text-xs"
                        >
                          <Send className="mr-1.5 size-3.5" aria-hidden />
                          {t("transfers.ship")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(t("transfers.cancelConfirm"))) {
                              cancel.mutate({ id: tr.id });
                            }
                          }}
                          className="h-9 text-xs text-status-bad hover:bg-status-bad-bg/20"
                        >
                          {t("common.cancel")}
                        </Button>
                      </>
                    ) : null}

                    {tr.status === "IN_TRANSIT" && can("stock:transfer") ? (
                      <Button size="sm" onClick={() => setReceiving(tr)} className="h-9 text-xs">
                        <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden />
                        {t("transfers.receive")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {/* Modale de création de transfert */}
      {creating ? <CreateTransferModal onClose={() => setCreating(false)} /> : null}

      {/* Modale tactile de réception avec ajustement de quantités */}
      {receiving ? (
        <ReceiveTransferModal transfer={receiving} onClose={() => setReceiving(null)} />
      ) : null}

      {/* Modale d'explication d'anomalie de transfert */}
      {shortfallInfo ? (
        <ShortfallModal transfer={shortfallInfo} onClose={() => setShortfallInfo(null)} />
      ) : null}
    </div>
  );
}

function CreateTransferModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const me = useMe();
  const [fromSiteId, setFrom] = useDefaultSite();
  const [toSiteId, setTo] = useState("");
  const [lines, setLines] = useState<{ product: PickedProduct; quantity: string }[]>([]);

  const create = trpc.stockTransfer.create.useMutation({
    onSuccess() {
      void utils.stockTransfer.invalidate();
      onClose();
    },
  });

  const otherSite = me.data?.allowedSites.find((s) => s.id !== fromSiteId)?.id ?? "";
  const target = toSiteId || otherSite;

  return (
    <Modal
      open
      size="lg"
      title={t("transfers.new")}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!fromSiteId || !target || lines.length === 0 || create.isPending}
            onClick={() =>
              create.mutate({
                fromSiteId,
                toSiteId: target,
                lines: lines.map((l) => ({
                  productId: l.product.id,
                  quantity: Number(l.quantity.replace(",", ".")),
                })),
              })
            }
          >
            {t("transfers.create")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SiteSelect label={t("transfers.from")} value={fromSiteId} onChange={setFrom} />
          <SiteSelect label={t("transfers.to")} value={target} onChange={setTo} />
        </div>

        <ProductPicker
          label={t("transfers.addLine")}
          onPick={(p) =>
            setLines((ls) =>
              ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, quantity: "1" }],
            )
          }
        />

        <ul className="flex flex-col gap-2.5">
          {lines.map((l, i) => (
            <li
              key={l.product.id}
              className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-2 p-3"
            >
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-sm text-foreground">{l.product.name}</span>
                <span className="block text-xs text-muted">{l.product.sku}</span>
              </div>
              <div className="w-32">
                <Input
                  label={`${t("common.quantity")} (${l.product.unit})`}
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                className="text-status-bad"
              >
                {t("common.remove")}
              </Button>
            </li>
          ))}
        </ul>

        <InlineError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </Modal>
  );
}

function ReceiveTransferModal({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(
      transfer.lines.map((l) => [
        l.id,
        String(l.quantity / l.product.quantityScale).replace(".", ","),
      ]),
    ),
  );
  const [reason, setReason] = useState("");

  const receive = trpc.stockTransfer.receive.useMutation({
    onSuccess() {
      void utils.stockTransfer.invalidate();
      void utils.product.invalidate();
      onClose();
    },
  });

  const hasAnyShortfall = transfer.lines.some((l) => {
    const val = Number((qty[l.id] ?? "0").replace(",", "."));
    const sent = l.quantity / l.product.quantityScale;
    return val !== sent;
  });

  const setAllConform = () => {
    const all: Record<string, string> = {};
    for (const l of transfer.lines) {
      all[l.id] = String(l.quantity / l.product.quantityScale).replace(".", ",");
    }
    setQty(all);
  };

  return (
    <Modal
      open
      size="lg"
      title={t("transfers.receiveTitle", { number: transfer.number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            loading={receive.isPending}
            onClick={() =>
              receive.mutate({
                id: transfer.id,
                lines: transfer.lines.map((l) => ({
                  lineId: l.id,
                  receivedQty: Number((qty[l.id] ?? "0").replace(",", ".")),
                })),
              })
            }
          >
            {t("transfers.receiveSubmit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-lg bg-surface-2 p-3 text-xs text-muted">
          <span>{t("transfers.receiveTactileHint")}</span>
          <Button variant="secondary" size="sm" onClick={setAllConform} className="text-xs">
            {t("transfers.conformBadge")}
          </Button>
        </div>

        <ul className="flex flex-col gap-3">
          {transfer.lines.map((l) => {
            const currentQty = Number((qty[l.id] ?? "0").replace(",", "."));
            const maxSent = l.quantity / l.product.quantityScale;
            const isDiff = currentQty !== maxSent;

            return (
              <li
                key={l.id}
                className={`flex flex-col gap-2 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                  isDiff ? "border-status-bad/40 bg-status-bad-bg/10" : "border-border bg-surface"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-foreground">{l.product.name}</div>
                  <div className="text-xs text-muted">
                    {t("transfers.sentQty", {
                      qty: qtyText(l.quantity, l.product.quantityScale, l.product.unit),
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(0, currentQty - 1);
                      setQty({ ...qty, [l.id]: String(next).replace(".", ",") });
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-lg font-bold hover:bg-surface"
                  >
                    -
                  </button>
                  <div className="w-24">
                    <Input
                      label={t("transfers.receivedQty")}
                      inputMode="decimal"
                      value={qty[l.id] ?? ""}
                      onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = currentQty + 1;
                      setQty({ ...qty, [l.id]: String(next).replace(".", ",") });
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-2 text-lg font-bold hover:bg-surface"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {hasAnyShortfall ? (
          <div className="flex flex-col gap-2 rounded-lg border border-status-warn/40 bg-status-warn-bg/20 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-status-warn">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span>{t("transfers.shortfallWarning")}</span>
            </div>
            <Input
              label={t("transfers.receiveReasonLabel")}
              placeholder={t("transfers.receiveReasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}

        <InlineError message={receive.error ? errorMessage(receive.error) : null} />
      </div>
    </Modal>
  );
}

function ShortfallModal({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const shortfalls = transfer.lines.filter((l) => l.receivedQty !== l.quantity);

  return (
    <Modal
      open
      title={t("transfers.shortfallModalTitle", { number: transfer.number })}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-xs text-muted">{t("transfers.shortfallModalDesc")}</p>

        <ul className="flex flex-col gap-2.5">
          {shortfalls.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between rounded-lg border border-status-bad/30 bg-status-bad-bg/10 p-3"
            >
              <div>
                <span className="font-semibold text-foreground">{l.product.name}</span>
                <span className="block text-xs text-muted">{l.product.sku}</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-status-bad">
                  {t("transfers.shortfall", {
                    qty: qtyText(
                      l.quantity - l.receivedQty,
                      l.product.quantityScale,
                      l.product.unit,
                    ),
                  })}
                </span>
                <span className="block text-[11px] text-muted">
                  {t("transfers.sentQty", {
                    qty: qtyText(l.quantity, l.product.quantityScale, l.product.unit),
                  })}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
