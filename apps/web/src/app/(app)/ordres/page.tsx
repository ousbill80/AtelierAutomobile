"use client";

// M04 §7 — /ordres : compteurs, vues Tableau (kanban par statut actif, glisser-déposer
// contrôlé par la machine à états) et Liste (cartes sur mobile), filtres et recherche.
import { useState, type DragEvent } from "react";
import Link from "next/link";
import {
  Car,
  Check,
  CircleCheck,
  Columns3,
  Hand,
  List as ListIcon,
  Package,
  PenLine,
  Plus,
  Search,
  TriangleAlert,
  Undo2,
  User,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
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

  const c = counters.data?.counters;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-col gap-5 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("subtitle")}</p>
        </div>
        <Link href="/ordres/reception" className="btn btn-primary min-h-11">
          <Plus size={16} aria-hidden /> {t("newReception")}
        </Link>
      </header>

      {counters.isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      )}
      {c && (
        <div
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
          aria-label={t("title")}
        >
          <Kpi icon={Wrench} label={t("kpi.active")} value={c.active} />
          <Kpi
            icon={Hand}
            label={t("kpi.awaitingApproval")}
            value={c.awaitingApproval}
            tone={c.awaitingApproval > 0 ? "warn" : "neutral"}
          />
          <Kpi
            icon={Package}
            label={t("kpi.waitingParts")}
            value={c.waitingParts}
            tone={c.waitingParts > 0 ? "bad" : "neutral"}
          />
          <Kpi icon={CircleCheck} label={t("kpi.ready")} value={c.ready} tone="ok" />
          <Kpi
            icon={TriangleAlert}
            label={t("kpi.late")}
            value={c.late}
            tone={c.late > 0 ? "bad" : "neutral"}
            pressed={filters.late}
            onClick={() => toggle("late")}
          />
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-11 min-w-0 flex-1 basis-64 items-center gap-2 rounded-md border border-border bg-bg px-3 focus-within:border-primary">
            <Search size={16} aria-hidden className="shrink-0 text-muted" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
              placeholder={t("filters.search")}
              aria-label={t("filters.search")}
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            />
            {filters.q && (
              <button
                type="button"
                aria-label={t("close")}
                onClick={() => setFilters((f) => ({ ...f, q: "" }))}
                className="flex h-8 w-8 items-center justify-center rounded text-muted hover:text-foreground"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </label>
          <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1" role="group">
            {VIEWS.map(({ key, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                aria-pressed={view === key}
                className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors ${
                  view === key
                    ? "bg-surface text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Icon size={15} aria-hidden />
                {t(`views.${key}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_CHIPS.map(({ key, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={filters[key]}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                filters[key]
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "border-border bg-surface text-muted hover:border-primary hover:text-foreground"
              }`}
            >
              {filters[key] ? <Check size={14} aria-hidden /> : <Icon size={14} aria-hidden />}
              {t(`filters.${key}`)}
            </button>
          ))}
          <select
            aria-label={t("filters.priority")}
            className="h-9 rounded-full border border-border bg-surface px-3 text-sm text-foreground"
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
              className="h-9 rounded-full border border-border bg-surface px-3 text-sm text-foreground"
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
      </div>

      {view === "board" ? <Board filters={filters} /> : <List filters={filters} />}
    </div>
  );
}

const VIEWS = [
  { key: "board", Icon: Columns3 },
  { key: "list", Icon: ListIcon },
] as const;

const FILTER_CHIPS = [
  { key: "mine", Icon: User },
  { key: "late", Icon: TriangleAlert },
  { key: "comeback", Icon: Undo2 },
] as const;

type Tone = "neutral" | "ok" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  ok: "text-status-ok",
  warn: "text-status-warn",
  bad: "text-status-bad",
};

const TONE_ICON_BG: Record<Tone, string> = {
  neutral: "bg-surface-2 text-foreground",
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
};

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  pressed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: Tone;
  pressed?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_ICON_BG[tone]}`}
      >
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 text-left">
        <span
          className={`block text-2xl leading-none font-semibold tabular-nums ${TONE_TEXT[tone]}`}
        >
          {value}
        </span>
        <span className="mt-1 block truncate text-xs font-medium text-muted">{label}</span>
      </span>
    </>
  );
  const base = "flex min-h-11 items-center gap-3 rounded-lg border bg-surface p-4";
  if (!onClick) return <div className={`${base} border-border`}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`${base} transition-colors hover:border-primary ${pressed ? "border-primary ring-1 ring-primary" : "border-border"}`}
    >
      {body}
    </button>
  );
}

type Card = BoardCard;

function CardBody({ card, timeZone }: { card: Card; timeZone?: string }) {
  return (
    <>
      <div className="orders-card-header">
        <span className="orders-card-number">{card.number}</span>
        {card.priority !== "NORMAL" && (
          <span className={`orders-card-priority ${card.priority.toLowerCase()}`}>
            {t(`priority.${card.priority}`)}
          </span>
        )}
      </div>
      <div className="orders-card-vehicle">
        <PlateBadge plate={card.vehicle.plate} />
        <span>
          {card.vehicle.make} {card.vehicle.model}
        </span>
      </div>
      <span className="orders-card-customer">{card.customer.displayName}</span>
      <span className="orders-card-mechanic flex items-center gap-1.5">
        <Wrench size={12} aria-hidden className="shrink-0" />
        {card.mechanics.length ? card.mechanics.join(", ") : t("card.noMechanic")}
      </span>
      <PromiseCountdown promisedAt={card.promisedAt} late={card.late} timeZone={timeZone} />
      <div className="orders-card-badges">
        {card.pendingApproval && (
          <span className="orders-card-badge approval">
            <Hand size={11} aria-hidden /> {t("card.pendingApproval")}
          </span>
        )}
        {card.waitingParts && (
          <span className="orders-card-badge parts">
            <Package size={11} aria-hidden /> {t("card.waitingParts")}
          </span>
        )}
        {card.isComeback && (
          <span className="orders-card-badge comeback">
            <Undo2 size={11} aria-hidden /> {t("card.comeback")}
          </span>
        )}
        {card.signaturePending && (
          <span className="orders-card-badge signature">
            <PenLine size={11} aria-hidden /> {t("card.signaturePending")}
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
    <div className="orders-board">
      {message && (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          className={`orders-message ${message.tone}`}
        >
          {message.text}
        </p>
      )}
      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface">
          <EmptyState
            icon={<Car size={28} aria-hidden />}
            title={
              filters.q || filters.late || filters.mine || filters.comeback || filters.priority
                ? t("emptyFiltered")
                : t("empty")
            }
            description={t("emptyHint")}
            action={
              <Link href="/ordres/reception" className="btn btn-primary min-h-11">
                <Plus size={16} aria-hidden /> {t("newReception")}
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <p className="orders-drag-hint">{t("board.dragHint")}</p>
          <div className="orders-kanban" data-testid="kanban">
            {data.columns.map((column) => (
              <section
                key={column.status}
                aria-label={t(`status.${column.status}`)}
                data-status={column.status}
                className="orders-kanban-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e: DragEvent) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const card = all.find((c) => c.id === id);
                  if (card) move(card, column.status);
                }}
              >
                <header className="orders-kanban-header">
                  <RepairOrderStatusBadge status={column.status} />
                  <span className="orders-kanban-count">{visible(column.cards).length}</span>
                </header>
                <div className="orders-kanban-cards">
                  {visible(column.cards).map((card) => (
                    <article
                      key={card.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", card.id)}
                      className={`orders-card ${card.late ? "late" : ""}`}
                    >
                      <Link href={`/ordres/${card.id}`}>
                        <CardBody card={card} timeZone={data.timeZone} />
                      </Link>
                      <div className="orders-card-move">
                        <select
                          aria-label={`${t("board.moveTo")} ${card.number}`}
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
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
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
      <div className="rounded-lg border border-dashed border-border bg-surface">
        <EmptyState
          icon={<Car size={28} aria-hidden />}
          title={
            filters.q ||
            filters.status ||
            filters.late ||
            filters.mine ||
            filters.comeback ||
            filters.priority
              ? t("emptyFiltered")
              : t("empty")
          }
          description={t("emptyHint")}
          action={
            <Link href="/ordres/reception" className="btn btn-primary min-h-11">
              <Plus size={16} aria-hidden /> {t("newReception")}
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <div className="orders-list">
      <div className="orders-list-header">
        <span>{t("columns.number")}</span>
        <span>{t("columns.date")}</span>
        <span>{t("columns.plate")}</span>
        <span>{t("columns.customer")}</span>
        <span>{t("columns.status")}</span>
        <span>{t("columns.advisor")}</span>
        <span>{t("columns.promise")}</span>
        <span>{t("columns.total")}</span>
      </div>
      {items.map((o) => (
        <Link
          key={o.id}
          href={`/ordres/${o.id}`}
          className={`orders-list-item ${o.late ? "late" : ""}`}
        >
          <span className="orders-list-number">{o.number}</span>
          <span className="orders-list-date">{formatDay(o.createdAt, timeZone)}</span>
          <span>
            <PlateBadge plate={o.vehicle.plate} />
          </span>
          <span className="orders-list-customer">
            {o.customer.displayName}
            <span>
              {" "}
              · {o.vehicle.make} {o.vehicle.model}
            </span>
          </span>
          <span>
            <RepairOrderStatusBadge status={o.status} />
          </span>
          <span className="orders-list-advisor">{o.advisorName ?? "—"}</span>
          <PromiseCountdown promisedAt={o.promisedAt} late={o.late} timeZone={timeZone} />
          <span className="orders-list-total">{formatFCFA(o.totalEstimate)}</span>
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
