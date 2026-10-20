"use client";

// M04 §7 — /ordres : KPIs opérationnels interactifs, Tableau (kanban par statut actif,
// glisser-déposer contrôlé par la machine à états) et Liste (DataTable responsive),
// recherche textuelle intelligente instantanée, filtres dynamiques et actions rapides.
import { useCallback, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  Download,
  Kanban,
  Layers,
  List as ListIcon,
  RotateCcw,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { formatFCFA } from "@atelieros/core/money";
import { BOARD_STATUSES, REPAIR_ORDER_STATUSES } from "@atelieros/core/repairOrders";
import { Button, DataTable, type DataTableColumn, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { PromiseCountdown, RepairOrderStatusBadge } from "@/components/repair-orders/badges";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { formatDay, t } from "@/components/repair-orders/i18n";
import type { BoardCard } from "@/components/repair-orders/types";

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
type Transition =
  | "start_diagnosis"
  | "approve"
  | "request_approval"
  | "start_work"
  | "wait_parts"
  | "resume"
  | "complete_work";

/** Glisser une carte vers une colonne → transition de la machine à états (sinon : ouvrir l'OR). */
function transitionFor(from: string, to: string): Transition | null {
  if (to === "DIAGNOSING" && from === "CHECKED_IN") return "start_diagnosis";
  if (to === "AWAITING_APPROVAL") return "request_approval";
  if (to === "APPROVED") return "approve";
  if (to === "IN_PROGRESS" && from === "APPROVED") return "start_work";
  if (to === "IN_PROGRESS" && from === "WAITING_PARTS") return "resume";
  if (to === "WAITING_PARTS") return "wait_parts";
  if ((to === "QUALITY_CHECK" || to === "READY") && from === "IN_PROGRESS") return "complete_work";
  return null;
}

interface Filters {
  mine: boolean;
  late: boolean;
  comeback: boolean;
  priority?: Priority;
  status?: string;
  q: string;
}

export default function RepairOrdersPage() {
  const [view, setView] = useState<"board" | "list">("board");
  const [filters, setFilters] = useState<Filters>({
    mine: false,
    late: false,
    comeback: false,
    q: "",
  });

  const countersQuery = trpc.repairOrder.list.useQuery(
    { limit: 1 },
    { refetchInterval: 30_000 },
  );

  const counters = countersQuery.data?.counters;

  const toggle = useCallback((key: "mine" | "late" | "comeback") => {
    setFilters((f) => ({ ...f, [key]: !f[key] }));
  }, []);

  const hasActiveFilters = Boolean(
    filters.q.trim() ||
      filters.status ||
      filters.priority ||
      filters.late ||
      filters.mine ||
      filters.comeback,
  );

  const resetFilters = useCallback(() => {
    setFilters({
      mine: false,
      late: false,
      comeback: false,
      priority: undefined,
      status: undefined,
      q: "",
    });
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* En-tête de page */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("title")}</h1>
          <p className="text-xs text-muted sm:text-sm">{t("description")}</p>
        </div>
        <Link
          href="/ordres/reception"
          className="btn btn-primary inline-flex min-h-11 items-center gap-2 px-4 shadow-sm"
        >
          <span>+</span>
          <span>{t("newReception")}</span>
        </Link>
      </div>

      {/* Cartes d'indicateurs opérationnels (KPIs) interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {/* KPI 1 : Total OR ouverts */}
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({ ...f, status: undefined, late: false }));
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            !filters.status && !filters.late
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.totalOpen")}</span>
            <Wrench className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {counters?.active ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.totalOpenSub")}</span>
        </button>

        {/* KPI 2 : En cours d'intervention */}
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({
              ...f,
              status: f.status === "IN_PROGRESS" ? undefined : "IN_PROGRESS",
              late: false,
            }));
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            filters.status === "IN_PROGRESS"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.inProgress")}</span>
            <Clock className="size-4 text-accent" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-foreground">
            {counters?.inProgress ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.inProgressSub")}</span>
        </button>

        {/* KPI 3 : Attente accord client */}
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({
              ...f,
              status: f.status === "AWAITING_APPROVAL" ? undefined : "AWAITING_APPROVAL",
              late: false,
            }));
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            filters.status === "AWAITING_APPROVAL"
              ? "border-status-warn bg-status-warn/5 ring-1 ring-status-warn"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.awaitingApproval")}</span>
            <AlertTriangle className="size-4 text-status-warn" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-status-warn">
            {counters?.awaitingApproval ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.awaitingApprovalSub")}</span>
        </button>

        {/* KPI 4 : Attente pièces */}
        <button
          type="button"
          onClick={() => {
            setFilters((f) => ({
              ...f,
              status: f.status === "WAITING_PARTS" ? undefined : "WAITING_PARTS",
              late: false,
            }));
          }}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 ${
            filters.status === "WAITING_PARTS"
              ? "border-status-bad bg-status-bad/5 ring-1 ring-status-bad"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">{t("kpis.waitingParts")}</span>
            <Layers className="size-4 text-status-bad" aria-hidden />
          </div>
          <span className="text-2xl font-bold text-status-bad">
            {counters?.waitingParts ?? 0}
          </span>
          <span className="text-xs text-muted">{t("kpis.waitingPartsSub")}</span>
        </button>

        {/* KPI 5 : OR en retard ⚠️ */}
        <button
          type="button"
          onClick={() => {
            toggle("late");
          }}
          className={`col-span-2 flex flex-col gap-1 rounded-xl border p-3 text-left transition-all hover:border-foreground/30 sm:col-span-1 ${
            filters.late
              ? "border-status-bad bg-status-bad/10 ring-1 ring-status-bad"
              : "border-border bg-surface"
          }`}
        >
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-semibold uppercase tracking-wider text-status-bad">
              {t("kpis.late")}
            </span>
            <AlertTriangle className="size-4 text-status-bad" aria-hidden />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-status-bad">
              {counters?.late ?? 0}
            </span>
            {(counters?.late ?? 0) > 0 && (
              <span className="rounded-full bg-status-bad/20 px-1.5 py-0.5 text-[10px] font-bold text-status-bad">
                ⚠️
              </span>
            )}
          </div>
          <span className="text-xs text-muted">{t("kpis.lateSub")}</span>
        </button>
      </div>

      {/* Barre de filtres et recherche intelligente */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Recherche textuelle avec bouton effacer */}
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
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
            {filters.q ? (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, q: "" }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label={t("cancel")}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Bascule de vue Tableau / Liste */}
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="group">
            <button
              type="button"
              onClick={() => setView("board")}
              aria-pressed={view === "board"}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${
                view === "board"
                  ? "bg-surface text-foreground shadow-sm font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Kanban className="size-3.5" aria-hidden />
              <span>{t("views.board")}</span>
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition ${
                view === "list"
                  ? "bg-surface text-foreground shadow-sm font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <ListIcon className="size-3.5" aria-hidden />
              <span>{t("views.list")}</span>
            </button>
          </div>

          {/* Filtre Mes OR */}
          <button
            type="button"
            onClick={() => toggle("mine")}
            aria-pressed={filters.mine}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
              filters.mine
                ? "border-accent bg-accent/10 text-accent font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {filters.mine ? "✓ " : ""}
            {t("filters.mine")}
          </button>

          {/* Filtre En retard */}
          <button
            type="button"
            onClick={() => toggle("late")}
            aria-pressed={filters.late}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
              filters.late
                ? "border-status-bad bg-status-bad/10 text-status-bad font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            <AlertTriangle className="size-3.5" aria-hidden />
            {t("filters.late")}
            {(counters?.late ?? 0) > 0 && (
              <span className="rounded-full bg-status-bad/20 px-1.5 py-0.2 text-[10px] font-bold text-status-bad">
                {counters?.late}
              </span>
            )}
          </button>

          {/* Filtre Retours garantie */}
          <button
            type="button"
            onClick={() => toggle("comeback")}
            aria-pressed={filters.comeback}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition ${
              filters.comeback
                ? "border-accent bg-accent/10 text-accent font-semibold"
                : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {filters.comeback ? "✓ " : ""}
            {t("filters.comeback")}
          </button>

          {/* Sélecteur de priorité */}
          <select
            aria-label={t("filters.priority")}
            className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            value={filters.priority ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                priority: (e.target.value || undefined) as Priority | undefined,
              }))
            }
          >
            <option value="">{t("filters.allPriorities")}</option>
            {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`priority.${p}`)}
              </option>
            ))}
          </select>

          {/* Sélecteur de statut */}
          <select
            aria-label={t("filters.status")}
            className="min-h-11 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:border-accent focus:outline-none"
            value={filters.status ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined }))}
          >
            <option value="">{t("filters.allStatuses")}</option>
            {REPAIR_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>

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
      </div>

      {/* Contenu principal : Vue Tableau ou Vue Liste */}
      {view === "board" ? (
        <Board filters={filters} onResetFilters={resetFilters} hasActiveFilters={hasActiveFilters} />
      ) : (
        <List filters={filters} onResetFilters={resetFilters} hasActiveFilters={hasActiveFilters} />
      )}
    </div>
  );
}

type Card = BoardCard;

function CardBody({ card, timeZone }: { card: Card; timeZone?: string }) {
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{card.number}</span>
        {card.priority !== "NORMAL" && (
          <span
            className={`text-xs ${card.priority === "URGENT" ? "font-semibold text-status-bad" : "text-muted"}`}
          >
            {t(`priority.${card.priority}`)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PlateBadge plate={card.vehicle.plate} />
        <span className="text-sm font-medium">
          {card.vehicle.make} {card.vehicle.model}
        </span>
      </div>
      <span className="truncate text-sm font-medium text-foreground">{card.customer.displayName}</span>
      <span className="text-xs text-muted">
        🔧 {card.mechanics.length ? card.mechanics.join(", ") : t("card.noMechanic")}
      </span>
      <PromiseCountdown promisedAt={card.promisedAt} late={card.late} timeZone={timeZone} />
      <div className="flex flex-wrap gap-1 text-xs">
        {card.pendingApproval && (
          <span className="rounded bg-status-warn-bg px-1.5 py-0.5 text-status-warn">
            ✋ {t("card.pendingApproval")}
          </span>
        )}
        {card.waitingParts && (
          <span className="rounded bg-status-bad-bg px-1.5 py-0.5 text-status-bad">
            📦 {t("card.waitingParts")}
          </span>
        )}
        {card.isComeback && (
          <span className="rounded bg-status-bad-bg px-1.5 py-0.5 text-status-bad">
            ↩ {t("card.comeback")}
          </span>
        )}
        {card.signaturePending && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-foreground">
            ✍ {t("card.signaturePending")}
          </span>
        )}
      </div>
    </>
  );
}

function Board({
  filters,
  onResetFilters,
  hasActiveFilters,
}: {
  filters: Filters;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}) {
  const utils = trpc.useUtils();
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const board = trpc.repairOrder.board.useQuery({
    mine: filters.mine || undefined,
    late: filters.late || undefined,
    priority: filters.priority,
  });

  const transition = trpc.repairOrder.transition.useMutation({
    onSuccess(order) {
      setMessage({
        tone: "ok",
        text: t("board.moved", { number: order.number, status: t(`status.${order.status}`) }),
      });
      void utils.repairOrder.board.invalidate();
      void utils.repairOrder.list.invalidate();
    },
    onError(error) {
      setMessage({ tone: "bad", text: error.message });
    },
  });

  const move = (card: Card, to: string) => {
    if (to === card.status) return;
    const name = transitionFor(card.status, to);
    if (!name) {
      setMessage({ tone: "bad", text: t("board.forbidden") });
      return;
    }
    transition.mutate({ id: card.id, transition: name });
  };

  if (board.isLoading) return <ListSkeleton />;
  if (board.isError) return <ErrorBox onRetry={() => board.refetch()} />;
  const data = board.data!;
  const q = filters.q.trim().toLowerCase();

  const visible = (cards: Card[]) =>
    cards.filter(
      (c) =>
        (!filters.comeback || c.isComeback) &&
        (!filters.status || c.status === filters.status) &&
        (!q ||
          c.number.toLowerCase().includes(q) ||
          c.vehicle.plate.toLowerCase().replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
          c.vehicle.make.toLowerCase().includes(q) ||
          c.vehicle.model.toLowerCase().includes(q) ||
          c.customer.displayName.toLowerCase().includes(q)),
    );

  const displayedColumns = filters.status
    ? data.columns.filter((col) => col.status === filters.status)
    : data.columns;

  const total = displayedColumns.reduce((s, c) => s + visible(c.cards).length, 0);
  const all = data.columns.flatMap((c) => c.cards);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {message && (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          className={`rounded-md p-2 text-sm ${
            message.tone === "bad"
              ? "bg-status-bad-bg text-status-bad"
              : "bg-status-ok-bg text-status-ok"
          }`}
        >
          {message.text}
        </p>
      )}

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Search className="size-6" aria-hidden />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-foreground">
            {hasActiveFilters ? t("emptyFiltered.title") : t("empty")}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted">
            {hasActiveFilters
              ? t("emptyFiltered.description")
              : t("emptyDescription")}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {hasActiveFilters ? (
              <Button variant="secondary" onClick={onResetFilters}>
                <RotateCcw className="size-4" aria-hidden />
                {t("filters.resetFilters")}
              </Button>
            ) : (
              <Link href="/ordres/reception" className="btn btn-primary">
                + {t("newReception")}
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-muted">
            <p className="hidden md:block">{t("board.dragHint")}</p>
            <span>{t("filters.shown", { count: total })}</span>
          </div>
          <div className="w-full max-w-full overflow-x-auto pb-2" data-testid="kanban">
            <div className="flex gap-3">
              {displayedColumns.map((column) => {
                const columnCards = visible(column.cards);
                return (
                  <section
                    key={column.status}
                    aria-label={t(`status.${column.status}`)}
                    data-status={column.status}
                    className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-surface-2 p-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e: DragEvent) => {
                      const id = e.dataTransfer.getData("text/plain");
                      const card = all.find((c) => c.id === id);
                      if (card) move(card, column.status);
                    }}
                  >
                    <header className="flex items-center justify-between px-1">
                      <RepairOrderStatusBadge status={column.status} />
                      <span className="rounded-full bg-surface px-1.5 py-0.5 text-xs font-semibold text-muted">
                        {columnCards.length}
                      </span>
                    </header>
                    {columnCards.map((card) => (
                      <article
                        key={card.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                        className={`flex flex-col gap-1 rounded-md border bg-surface p-2 shadow-sm transition hover:border-accent ${
                          card.late ? "border-status-bad" : "border-border"
                        }`}
                      >
                        <Link
                          href={`/ordres/${card.id}`}
                          className="flex flex-col gap-1 hover:underline-offset-2"
                        >
                          <CardBody card={card} timeZone={data.timeZone} />
                        </Link>
                        <select
                          aria-label={`${t("board.moveTo")} ${card.number}`}
                          className="mt-1 min-h-10 rounded border border-border bg-surface px-1 text-xs text-muted hover:text-foreground"
                          value=""
                          onChange={(e) => move(card, e.target.value)}
                        >
                          <option value="">{t("board.moveTo")}</option>
                          {BOARD_STATUSES.filter((s) => s !== card.status).map((s) => (
                            <option key={s} value={s}>
                              {t(`status.${s}`)}
                            </option>
                          ))}
                        </select>
                      </article>
                    ))}
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function List({
  filters,
  onResetFilters,
  hasActiveFilters,
}: {
  filters: Filters;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}) {
  const router = useRouter();
  const query = trpc.repairOrder.list.useInfiniteQuery(
    {
      mine: filters.mine || undefined,
      late: filters.late || undefined,
      comeback: filters.comeback || undefined,
      priority: filters.priority,
      statuses: filters.status ? [filters.status as never] : undefined,
      q: filters.q.trim() || undefined,
      limit: 30,
    },
    { getNextPageParam: (last) => last.nextCursor ?? undefined },
  );

  if (query.isLoading) return <ListSkeleton />;
  if (query.isError) return <ErrorBox onRetry={() => query.refetch()} />;
  const pages = query.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const timeZone = pages[0]?.timeZone;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Search className="size-6" aria-hidden />
        </div>
        <h3 className="mt-3 text-sm font-semibold text-foreground">
          {hasActiveFilters ? t("emptyFiltered.title") : t("empty")}
        </h3>
        <p className="mt-1 max-w-sm text-xs text-muted">
          {hasActiveFilters
            ? t("emptyFiltered.description")
            : t("emptyDescription")}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {hasActiveFilters ? (
            <Button variant="secondary" onClick={onResetFilters}>
              <RotateCcw className="size-4" aria-hidden />
              {t("filters.resetFilters")}
            </Button>
          ) : (
            <Link href="/ordres/reception" className="btn btn-primary">
              + {t("newReception")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  type ItemType = (typeof items)[number];

  const columns: DataTableColumn<ItemType>[] = [
    {
      key: "number",
      header: t("columns.number"),
      primary: true,
      render: (o) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-sm font-semibold text-foreground">{o.number}</span>
            {o.late && (
              <span className="rounded bg-status-bad/20 px-1 text-[10px] font-bold text-status-bad">
                ⏰
              </span>
            )}
          </div>
          <span className="text-xs text-muted">{formatDay(o.createdAt, timeZone)}</span>
        </div>
      ),
    },
    {
      key: "vehicle",
      header: t("columns.vehicle"),
      render: (o) => (
        <div className="flex flex-col gap-1">
          <PlateBadge plate={o.vehicle.plate} />
          <span className="text-xs text-muted">
            {o.vehicle.make} {o.vehicle.model}
          </span>
        </div>
      ),
    },
    {
      key: "customer",
      header: t("columns.customer"),
      render: (o) => (
        <div className="flex flex-col">
          <span className="truncate text-sm font-medium text-foreground">{o.customer.displayName}</span>
          <span className="text-xs text-muted">
            {o.advisorName ? `${t("columns.advisor")}: ${o.advisorName}` : "—"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: t("columns.status"),
      render: (o) => (
        <div className="flex flex-col gap-1">
          <RepairOrderStatusBadge status={o.status} />
          {o.priority !== "NORMAL" && (
            <span
              className={`text-[11px] font-semibold ${
                o.priority === "URGENT" ? "text-status-bad" : "text-status-warn"
              }`}
            >
              {t(`priority.${o.priority}`)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "promise",
      header: t("columns.promise"),
      render: (o) => (
        <PromiseCountdown promisedAt={o.promisedAt} late={o.late} timeZone={timeZone} />
      ),
    },
    {
      key: "total",
      header: t("columns.total"),
      render: (o) => (
        <span className="text-sm font-bold text-foreground">
          {formatFCFA(o.totalEstimate)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("columns.actions"),
      render: (o) => (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <a
            href={`/api/ordres/${o.id}/pdf?kind=workshop`}
            target="_blank"
            rel="noopener noreferrer"
            title={t("actions.pdfWorkshop")}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <Download className="size-4" aria-hidden />
          </a>
          <Link
            href={`/ordres/${o.id}`}
            title={t("actions.open")}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{t("filters.shown", { count: items.length })}</span>
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/ordres/${o.id}`)}
      />

      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          loading={query.isFetchingNextPage}
          className="self-center"
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
