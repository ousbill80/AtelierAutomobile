"use client";

// M07 §7 — /stock/mouvements : journal d'audit et traçabilité des stocks.
// KPIs des flux, filtres multi-critères (type, site, date), badges de mouvement
// avec sens positif/négatif, liens directs vers OR/commandes et export CSV.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  Download,
  ExternalLink,
  History,
  Search,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import {
  downloadText,
  ErrorBox,
  ListSkeleton,
  ModuleNav,
  SiteSelect,
  useCan,
} from "../_lib/components";
import { formatDateTime, qtyText, t } from "../_lib/i18n";

const TYPES = [
  "PURCHASE_RECEIPT",
  "ISSUE_TO_RO",
  "RETURN_FROM_RO",
  "ADJUSTMENT",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "COUNT_CORRECTION",
  "SUPPLIER_RETURN",
] as const;
type MovementType = (typeof TYPES)[number];

const TYPE_CONFIG: Record<
  MovementType,
  { label: string; tone: "ok" | "warn" | "bad" | "off"; isIncoming: boolean }
> = {
  PURCHASE_RECEIPT: { label: "Réception achat", tone: "ok", isIncoming: true },
  ISSUE_TO_RO: { label: "Sortie atelier (OR)", tone: "warn", isIncoming: false },
  RETURN_FROM_RO: { label: "Retour d'atelier", tone: "ok", isIncoming: true },
  ADJUSTMENT: { label: "Ajustement manuel", tone: "off", isIncoming: false },
  TRANSFER_IN: { label: "Transfert entrant", tone: "ok", isIncoming: true },
  TRANSFER_OUT: { label: "Transfert sortant", tone: "warn", isIncoming: false },
  COUNT_CORRECTION: { label: "Écart inventaire", tone: "off", isIncoming: false },
  SUPPLIER_RETURN: { label: "Retour fournisseur", tone: "bad", isIncoming: false },
};

export default function MovementsPage() {
  const can = useCan();
  const utils = trpc.useUtils();
  const [type, setType] = useState<MovementType | "">("");
  const [siteId, setSiteId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [qSearch, setQSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = {
    type: type || undefined,
    siteId: siteId || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const list = trpc.stock.movements.useInfiniteQuery(
    { ...filters, limit: 50 },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  const rawRows = useMemo(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data?.pages],
  );

  const rows = useMemo(() => {
    if (!qSearch.trim()) return rawRows;
    const needle = qSearch.trim().toLowerCase();
    return rawRows.filter(
      (m) =>
        m.product.name.toLowerCase().includes(needle) ||
        (m.repairOrder?.number && m.repairOrder.number.toLowerCase().includes(needle)) ||
        (m.purchaseOrder?.number && m.purchaseOrder.number.toLowerCase().includes(needle)) ||
        (m.reason && m.reason.toLowerCase().includes(needle)) ||
        (m.createdBy && m.createdBy.toLowerCase().includes(needle)),
    );
  }, [rawRows, qSearch]);

  // Statistiques calculées sur les flux
  const stats = useMemo(() => {
    const total = rawRows.length;
    const incomingCount = rawRows.filter((m) => m.quantity > 0).length;
    const outgoingCount = rawRows.filter((m) => m.quantity < 0).length;
    const totalValue = rawRows.reduce((acc, m) => acc + (m.value != null ? Math.abs(m.value) : 0), 0);
    return { total, incomingCount, outgoingCount, totalValue };
  }, [rawRows]);

  const hasFilter = Boolean(type || siteId || from || to || qSearch.trim());

  const resetFilters = () => {
    setType("");
    setSiteId("");
    setFrom("");
    setTo("");
    setQSearch("");
  };

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await utils.stock.movementsCsv.fetch(filters);
      downloadText(csv.filename, csv.content);
    } finally {
      setExporting(false);
    }
  }

  const showCost = can("product:view_cost");

  return (
    <div className="flex flex-col gap-6 pb-16">
      <ModuleNav section="stock" />

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <History size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {t("movements.title")}
              </h1>
              {rawRows.length > 0 && (
                <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {rawRows.length} mouvement{rawRows.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-xs text-muted">
              Traçabilité chronologique complète de toutes les entrées, sorties et ajustements de stock
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="h-9 gap-1.5 text-xs font-medium"
            loading={exporting}
            onClick={() => void exportCsv()}
          >
            <Download size={14} className="text-muted" />
            <span>{t("movements.export")}</span>
          </Button>
        </div>
      </div>

      {/* Cartes KPI intelligentes */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Mouvements chargés</span>
            <History size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {stats.total}
          </div>
          <div className="mt-1 text-[11px] text-muted">Traçabilité magasin</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Entrées de stock</span>
            <ArrowDownLeft size={16} className="text-status-ok" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-status-ok">
            +{stats.incomingCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">Réceptions & Retours</div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Sorties atelier</span>
            <ArrowUpRight size={16} className="text-status-warn" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-status-warn">
            -{stats.outgoingCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">Affectations aux OR</div>
        </div>

        {showCost ? (
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Valeur mouvementée</span>
              <Building2 size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
              {formatFCFA(stats.totalValue)}
            </div>
            <div className="mt-1 text-[11px] text-muted">Flux valorisé PMP</div>
          </div>
        ) : (
          <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-3.5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Site filtré</span>
              <Building2 size={16} className="text-muted" />
            </div>
            <div className="mt-2 text-sm font-semibold text-foreground truncate">
              {siteId ? "Site spécifique" : "Tous les sites"}
            </div>
            <div className="mt-1 text-[11px] text-muted">Magasins d&apos;atelier</div>
          </div>
        )}
      </div>

      {/* Barre d'outils et filtres avancés */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {/* Recherche textuelle */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Pièce, OR, commande, motif..."
              value={qSearch}
              onChange={(e) => setQSearch(e.target.value)}
              className="h-9 w-full rounded-lg border border-border/80 bg-surface pl-8 pr-3 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {/* Type de mouvement */}
          <select
            value={type}
            onChange={(e) => setType(e.target.value as MovementType | "")}
            className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
          >
            <option value="">{t("movements.allTypes")}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`movementTypes.${ty}`)}
              </option>
            ))}
          </select>

          {/* Site */}
          <SiteSelect value={siteId} onChange={setSiteId} allowAll />

          {/* Date début */}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
          />

          {/* Date fin */}
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-border/80 bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            />
            {hasFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs text-muted hover:text-foreground hover:bg-surface-2"
                title="Réinitialiser"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {list.isLoading ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <ErrorBox onRetry={() => list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("movements.empty")}
          description={
            hasFilter
              ? "Aucun mouvement de stock ne correspond à ces critères."
              : "Le journal des mouvements enregistrera chaque entrée, sortie ou ajustement."
          }
          action={
            hasFilter ? (
              <Button variant="secondary" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-surface-2/60 text-xs font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-3.5 pl-4 pr-3">{t("movements.columns.product")}</th>
                    <th className="px-3 py-3.5">{t("movements.columns.type")}</th>
                    <th className="px-3 py-3.5 text-right">{t("movements.columns.qty")}</th>
                    {showCost && (
                      <th className="px-3 py-3.5 text-right">{t("movements.columns.value")}</th>
                    )}
                    <th className="px-3 py-3.5">Site / Date</th>
                    <th className="px-3 py-3.5">{t("movements.columns.document")}</th>
                    <th className="px-3 py-3.5">{t("movements.columns.reason")}</th>
                    <th className="py-3.5 pl-3 pr-4 text-right">{t("movements.columns.user")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((m) => {
                    const cfg = TYPE_CONFIG[m.type as MovementType] ?? {
                      label: m.type,
                      tone: "off",
                      isIncoming: m.quantity > 0,
                    };
                    const isPositive = m.quantity > 0;

                    return (
                      <tr
                        key={m.id}
                        className="group transition-colors hover:bg-surface-2/40"
                      >
                        {/* Article */}
                        <td className="py-3.5 pl-4 pr-3">
                          <div className="flex flex-col">
                            <Link
                              href={`/stock/${m.product.id}`}
                              className="font-medium text-foreground hover:text-accent hover:underline"
                            >
                              {m.product.name}
                            </Link>
                          </div>
                        </td>

                        {/* Type de mouvement */}
                        <td className="px-3 py-3.5">
                          <StatusBadge tone={cfg.tone} label={t(`movementTypes.${m.type}`)} />
                        </td>

                        {/* Quantité */}
                        <td className="px-3 py-3.5 text-right tabular-nums">
                          <span
                            className={`font-bold ${
                              isPositive ? "text-status-ok" : "text-status-bad"
                            }`}
                          >
                            {isPositive ? "+" : ""}
                            {qtyText(m.quantity, m.product.quantityScale, m.product.unit)}
                          </span>
                        </td>

                        {/* Valeur financière (si autorisé) */}
                        {showCost && (
                          <td className="px-3 py-3.5 text-right tabular-nums text-xs">
                            {m.value != null ? (
                              <span className="font-semibold text-foreground">
                                {formatFCFA(Math.abs(m.value))}
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        )}

                        {/* Site / Date */}
                        <td className="px-3 py-3.5 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-foreground">{m.siteCode}</span>
                            <span className="text-muted">{formatDateTime(m.createdAt)}</span>
                          </div>
                        </td>

                        {/* Document lié (OR ou Commande) */}
                        <td className="px-3 py-3.5 text-xs">
                          {m.repairOrder ? (
                            <Link
                              href={`/ordres/${m.repairOrder.id}`}
                              className="inline-flex items-center gap-1 font-mono font-medium text-accent hover:underline"
                            >
                              <span>OR {m.repairOrder.number}</span>
                              <ExternalLink size={11} />
                            </Link>
                          ) : m.purchaseOrder ? (
                            <Link
                              href={`/achats/${m.purchaseOrder.id}`}
                              className="inline-flex items-center gap-1 font-mono font-medium text-accent hover:underline"
                            >
                              <span>BC {m.purchaseOrder.number}</span>
                              <ExternalLink size={11} />
                            </Link>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Motif / Justification */}
                        <td className="px-3 py-3.5 text-xs text-muted max-w-[180px] truncate">
                          {[m.reasonCode ? t(`adjust.codes.${m.reasonCode}`) : null, m.reason]
                            .filter(Boolean)
                            .join(" — ") || "—"}
                        </td>

                        {/* Utilisateur */}
                        <td className="py-3.5 pl-3 pr-4 text-right text-xs text-muted">
                          {m.createdBy ?? "Système"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {list.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t("common.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
