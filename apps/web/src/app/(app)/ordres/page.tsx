"use client";

// M04 §7 — /ordres : compteurs, vues Tableau (kanban par statut actif, glisser-déposer
// contrôlé par la machine à états) et Liste (cartes sur mobile), filtres et recherche.
import { useState, type DragEvent } from "react";
import Link from "next/link";
import { formatFCFA } from "@atelieros/core/money";
import { BOARD_STATUSES, REPAIR_ORDER_STATUSES } from "@atelieros/core/repairOrders";
import { Button, EmptyState, PlateBadge } from "@atelieros/ui";
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
  const counters = trpc.repairOrder.list.useQuery({ limit: 1 });

  const toggle = (key: "mine" | "late" | "comeback") =>
    setFilters((f) => ({ ...f, [key]: !f[key] }));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Link href="/ordres/reception" className="btn btn-primary min-h-11">
          + {t("newReception")}
        </Link>
      </div>

      {counters.data && (
        <div className="flex flex-wrap gap-2 text-sm" aria-label={t("title")}>
          <span className="rounded-md bg-surface-2 px-3 py-2">
            {t("counters.active", { count: counters.data.counters.active })}
          </span>
          <span className="rounded-md bg-status-warn-bg px-3 py-2 text-status-warn">
            {t("counters.awaitingApproval", { count: counters.data.counters.awaitingApproval })}
          </span>
          <span className="rounded-md bg-status-bad-bg px-3 py-2 text-status-bad">
            {t("counters.waitingParts", { count: counters.data.counters.waitingParts })}
          </span>
          <span className="rounded-md bg-status-ok-bg px-3 py-2 text-status-ok">
            {t("counters.ready", { count: counters.data.counters.ready })}
          </span>
          <span className="rounded-md bg-status-bad-bg px-3 py-2 font-semibold text-status-bad">
            ⏰ {t("counters.late", { count: counters.data.counters.late })}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["board", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`min-h-11 rounded-md px-3 ${view === v ? "bg-accent text-accent-foreground" : "bg-surface-2"}`}
          >
            {t(`views.${v}`)}
          </button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
        {(["mine", "late", "comeback"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={filters[key]}
            className={`min-h-11 rounded-md border border-border px-3 ${filters[key] ? "bg-surface-2 font-semibold" : "bg-surface"}`}
          >
            {filters[key] ? "✓ " : ""}
            {t(`filters.${key}`)}
          </button>
        ))}
        <select
          aria-label={t("filters.priority")}
          className="min-h-11 rounded-md border border-border bg-surface px-2"
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
        {view === "list" && (
          <select
            aria-label={t("filters.status")}
            className="min-h-11 rounded-md border border-border bg-surface px-2"
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
        )}
      </div>
      <input
        className="min-h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
        placeholder={t("filters.search")}
        aria-label={t("filters.search")}
        value={filters.q}
        onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
      />

      {view === "board" ? <Board filters={filters} /> : <List filters={filters} />}
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
        <span className="text-sm">
          {card.vehicle.make} {card.vehicle.model}
        </span>
      </div>
      <span className="truncate text-sm font-medium">{card.customer.displayName}</span>
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
          <span className="rounded bg-surface-2 px-1.5 py-0.5">
            ✍ {t("card.signaturePending")}
          </span>
        )}
      </div>
    </>
  );
}

function Board({ filters }: { filters: Filters }) {
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
        (!q ||
          c.number.toLowerCase().includes(q) ||
          c.vehicle.plate.toLowerCase().replace(/\s/g, "").includes(q.replace(/\s/g, "")) ||
          c.customer.displayName.toLowerCase().includes(q)),
    );
  const total = data.columns.reduce((s, c) => s + visible(c.cards).length, 0);
  const all = data.columns.flatMap((c) => c.cards);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {message && (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          className={`rounded-md p-2 text-sm ${message.tone === "bad" ? "bg-status-bad-bg text-status-bad" : "bg-status-ok-bg text-status-ok"}`}
        >
          {message.text}
        </p>
      )}
      {total === 0 ? (
        <EmptyState
          title={t("empty")}
          action={
            <Link href="/ordres/reception" className="btn btn-primary">
              {t("newReception")}
            </Link>
          }
        />
      ) : (
        <>
          <p className="hidden text-xs text-muted md:block">{t("board.dragHint")}</p>
          <div className="w-full max-w-full overflow-x-auto pb-2" data-testid="kanban">
            <div className="flex gap-3">
              {data.columns.map((column) => (
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
                    <span className="text-xs text-muted">{visible(column.cards).length}</span>
                  </header>
                  {visible(column.cards).map((card) => (
                    <article
                      key={card.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                      className={`flex flex-col gap-1 rounded-md border bg-surface p-2 ${card.late ? "border-status-bad" : "border-border"}`}
                    >
                      <Link
                        href={`/ordres/${card.id}`}
                        className="flex flex-col gap-1 hover:underline-offset-2"
                      >
                        <CardBody card={card} timeZone={data.timeZone} />
                      </Link>
                      <select
                        aria-label={`${t("board.moveTo")} ${card.number}`}
                        className="mt-1 min-h-11 rounded border border-border bg-surface px-1 text-xs"
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
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function List({ filters }: { filters: Filters }) {
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
      <EmptyState
        title={filters.q || filters.status || filters.late ? t("emptyFiltered") : t("empty")}
        action={
          <Link href="/ordres/reception" className="btn btn-primary">
            {t("newReception")}
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="hidden grid-cols-[8rem_6rem_7rem_1fr_9rem_8rem_9rem_8rem] gap-2 px-3 text-xs font-semibold text-muted lg:grid">
        <span>{t("columns.number")}</span>
        <span>{t("columns.date")}</span>
        <span>{t("columns.plate")}</span>
        <span>{t("columns.customer")}</span>
        <span>{t("columns.status")}</span>
        <span>{t("columns.advisor")}</span>
        <span>{t("columns.promise")}</span>
        <span className="text-right">{t("columns.total")}</span>
      </div>
      {items.map((o) => (
        <Link
          key={o.id}
          href={`/ordres/${o.id}`}
          className={`flex flex-col gap-1 rounded-lg border bg-surface p-3 hover:bg-surface-2 lg:grid lg:grid-cols-[8rem_6rem_7rem_1fr_9rem_8rem_9rem_8rem] lg:items-center lg:gap-2 ${o.late ? "border-status-bad" : "border-border"}`}
        >
          <span className="font-mono text-sm font-semibold">{o.number}</span>
          <span className="text-sm text-muted">{formatDay(o.createdAt, timeZone)}</span>
          <span>
            <PlateBadge plate={o.vehicle.plate} />
          </span>
          <span className="truncate text-sm">
            {o.customer.displayName}
            <span className="text-muted">
              {" "}
              · {o.vehicle.make} {o.vehicle.model}
            </span>
          </span>
          <span>
            <RepairOrderStatusBadge status={o.status} />
          </span>
          <span className="truncate text-sm text-muted">{o.advisorName ?? "—"}</span>
          <PromiseCountdown promisedAt={o.promisedAt} late={o.late} timeZone={timeZone} />
          <span className="text-sm font-semibold lg:text-right">{formatFCFA(o.totalEstimate)}</span>
        </Link>
      ))}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          onClick={() => query.fetchNextPage()}
          loading={query.isFetchingNextPage}
        >
          {t("loadMore")}
        </Button>
      )}
    </div>
  );
}
