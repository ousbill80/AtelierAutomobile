"use client";

// M06 US-M06-01 — /atelier : kanban des OR par étape (RG-M06-01), bandeau des retards
// (RG-M06-02), glisser-déposer contrôlé par les transitions M04 (colonnes grisées), sélecteur
// « Déplacer vers… » pour le tactile. Mobile : colonnes en onglets horizontaux.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Clock,
  PackageOpen,
  RotateCcw,
  Search,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { EmptyState, PageHead, Select } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { ErrorBox, ListSkeleton } from "@/components/repair-orders/error-box";
import { OrderCard } from "@/components/workshop/card";
import { tw } from "@/components/workshop/i18n";
import type { ColumnKey, WorkshopCard } from "@/components/workshop/types";

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

export default function WorkshopBoardPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [priority, setPriority] = useState<Priority | "">("");
  const [mechanicId, setMechanicId] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileColumn, setMobileColumn] = useState<ColumnKey>("in_progress");
  const [dragging, setDragging] = useState<WorkshopCard | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const board = trpc.workshop.board.useQuery(
    {
      priority: priority || undefined,
      mechanicId: mechanicId || undefined,
      lateOnly: lateOnly || undefined,
    },
    { refetchInterval: 30_000 },
  );
  const mechanics = trpc.workshop.mechanics.useQuery({}, { staleTime: 60_000 });
  const move = trpc.workshop.move.useMutation({
    onSuccess(result) {
      if (result.redirect) {
        router.push(result.redirect);
        return;
      }
      setMessage({ tone: "ok", text: tw("board.moved") });
      void utils.workshop.board.invalidate();
    },
    onError(error) {
      setMessage({ tone: "bad", text: `${tw("board.dropRefused")} : ${error.message}` });
    },
  });

  const drop = (card: WorkshopCard, to: ColumnKey) => {
    setDragging(null);
    if (card.column === to) return;
    move.mutate({ repairOrderId: card.id, to });
  };

  const rawColumns = useMemo(() => board.data?.columns ?? [], [board.data?.columns]);
  const total = rawColumns.reduce((s, c) => s + c.cards.length, 0);

  // Filtrage par recherche texte locale (plaque, client, numéro d'OR, véhicule)
  const columns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rawColumns;
    return rawColumns.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => {
        return (
          c.number.toLowerCase().includes(q) ||
          c.plate.toLowerCase().includes(q) ||
          c.customerName.toLowerCase().includes(q) ||
          c.vehicle.toLowerCase().includes(q)
        );
      }),
    }));
  }, [rawColumns, search]);

  // Statistiques globales du tableau
  const kpis = useMemo(() => {
    let inProgress = 0;
    let waitingParts = 0;
    let qcPending = 0;
    for (const col of rawColumns) {
      if (col.key === "in_progress") inProgress = col.cards.length;
      if (col.key === "waiting_parts") waitingParts = col.cards.length;
      if (col.key === "quality_check") qcPending = col.cards.length;
    }
    return {
      total,
      inProgress,
      waitingParts,
      qcPending,
      late: board.data?.lateCount ?? 0,
    };
  }, [rawColumns, total, board.data?.lateCount]);

  const hasActiveFilters = Boolean(priority || mechanicId || lateOnly || search.trim());

  const resetFilters = () => {
    setPriority("");
    setMechanicId("");
    setLateOnly(false);
    setSearch("");
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("title")} description={tw("board.description")} />

      {/* KPI Cards / Synthèse Atelier interactive */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium uppercase tracking-wider">
              {tw("kpis.totalOrders")}
            </span>
            <Wrench className="size-4 text-muted" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight">{kpis.total}</span>
          <span className="text-xs text-muted">OR ouverts</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-accent">
            <span className="text-xs font-medium uppercase tracking-wider">
              {tw("kpis.inProgress")}
            </span>
            <Wrench className="size-4 text-accent" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-accent">{kpis.inProgress}</span>
          <span className="text-xs text-muted">Sur les ponts</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-status-warn">
            <span className="text-xs font-medium uppercase tracking-wider">
              {tw("kpis.waitingParts")}
            </span>
            <PackageOpen className="size-4 text-status-warn" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-warn">
            {kpis.waitingParts}
          </span>
          <span className="text-xs text-muted">En attente magasin</span>
        </div>

        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3 text-left">
          <div className="flex items-center justify-between text-status-ok">
            <span className="text-xs font-medium uppercase tracking-wider">
              {tw("kpis.qcPending")}
            </span>
            <ShieldCheck className="size-4 text-status-ok" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-ok">{kpis.qcPending}</span>
          <span className="text-xs text-muted">Prêt pour contrôle</span>
        </div>

        <button
          type="button"
          onClick={() => setLateOnly(!lateOnly)}
          className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition ${
            lateOnly
              ? "border-status-bad bg-status-bad/10 shadow-sm"
              : "border-border bg-surface hover:border-status-bad/40"
          }`}
        >
          <div className="flex items-center justify-between text-status-bad">
            <span className="text-xs font-medium uppercase tracking-wider">{tw("kpis.late")}</span>
            <AlertTriangle className="size-4" aria-hidden />
          </div>
          <span className="text-2xl font-bold tracking-tight text-status-bad">{kpis.late}</span>
          <span className="text-xs text-muted">{tw("board.lateOnly")}</span>
        </button>
      </div>

      {/* Barre de filtres et recherche */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <div className="relative min-w-0 flex-1 basis-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            placeholder={tw("searchOrder")}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="w-full sm:w-auto sm:min-w-44">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
            <option value="">{tw("board.allPriorities")}</option>
            {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => (
              <option key={p} value={p}>
                {tw(`priorityLabels.${p}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="w-full sm:w-auto sm:min-w-48">
          <Select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
            <option value="">{tw("board.allMechanics")}</option>
            {mechanics.data?.mechanics.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>

        <button
          type="button"
          onClick={() => setLateOnly(!lateOnly)}
          className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
            lateOnly
              ? "border-status-bad bg-status-bad/10 text-status-bad font-semibold"
              : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
          }`}
        >
          <Clock className="size-4" aria-hidden />
          {tw("board.lateOnly")}
        </button>

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            Réinitialiser
          </button>
        ) : null}
      </div>

      {board.data && board.data.lateCount > 0 && !lateOnly ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-status-bad bg-status-bad-bg px-3 py-2 text-sm font-semibold text-status-bad"
        >
          <Clock className="size-4" aria-hidden />
          {tw("board.lateBanner", { count: board.data.lateCount })}
        </div>
      ) : null}

      {message ? (
        <p
          role={message.tone === "bad" ? "alert" : "status"}
          className={`text-sm ${message.tone === "bad" ? "text-status-bad" : "text-status-ok"}`}
        >
          {message.text}
        </p>
      ) : null}

      {board.isLoading ? (
        <ListSkeleton rows={4} />
      ) : board.isError ? (
        <ErrorBox message={tw("loadError")} onRetry={() => void board.refetch()} />
      ) : total === 0 ? (
        <EmptyState title={tw("board.emptyAll")} />
      ) : (
        <>
          {/* Mobile : colonnes en onglets horizontaux. */}
          <div className="md:hidden">
            <div className="-mx-1 overflow-x-auto" role="tablist" aria-label={tw("title")}>
              <div className="flex min-w-max gap-1 px-1">
                {columns.map((col) => (
                  <button
                    key={col.key}
                    type="button"
                    role="tab"
                    aria-selected={mobileColumn === col.key}
                    onClick={() => setMobileColumn(col.key)}
                    className={`min-h-11 rounded-md px-3 text-sm font-medium transition ${
                      mobileColumn === col.key
                        ? "bg-accent text-accent-foreground font-semibold"
                        : "bg-surface-2"
                    }`}
                  >
                    {tw(`columns.${col.key}`)} ({col.cards.length})
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              {(columns.find((c) => c.key === mobileColumn)?.cards ?? []).map((card) => (
                <OrderCard
                  key={card.id}
                  card={card}
                  timeZone={board.data?.timeZone ?? "Africa/Abidjan"}
                  footer={<MoveSelect card={card} onMove={(to) => drop(card, to)} />}
                />
              ))}
              {(columns.find((c) => c.key === mobileColumn)?.cards.length ?? 0) === 0 ? (
                <p className="text-sm text-muted">{tw("board.empty")}</p>
              ) : null}
            </div>
          </div>

          {/* Bureau : 7 colonnes, glisser-déposer. */}
          <div className="hidden overflow-x-auto pb-2 md:block">
            <div className="grid min-w-[1400px] grid-cols-7 gap-3">
              {columns.map((col) => {
                const allowed = !dragging || dragging.allowedColumns.includes(col.key);
                const isSource = dragging?.column === col.key;
                return (
                  <section
                    key={col.key}
                    aria-label={tw(`columns.${col.key}`)}
                    data-testid={`column-${col.key}`}
                    onDragOver={(e) => {
                      if (allowed && !isSource) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragging && allowed) drop(dragging, col.key);
                    }}
                    className={`flex min-h-64 flex-col gap-2 rounded-xl p-2.5 transition-opacity ${
                      dragging && !allowed && !isSource
                        ? "bg-surface-2 opacity-40"
                        : "bg-surface-2/60 border border-border/40"
                    }`}
                  >
                    <h3 className="flex items-center justify-between text-sm font-semibold text-foreground px-1">
                      <span>{tw(`columns.${col.key}`)}</span>
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-muted">
                        {col.cards.length}
                      </span>
                    </h3>
                    {col.cards.length === 0 ? (
                      <div className="flex flex-1 items-center justify-center p-4 text-center">
                        <p className="text-xs text-muted">{tw("board.empty")}</p>
                      </div>
                    ) : (
                      col.cards.map((card) => (
                        <OrderCard
                          key={card.id}
                          card={card}
                          timeZone={board.data?.timeZone ?? "Africa/Abidjan"}
                          draggable
                          onDragStart={() => setDragging(card)}
                          onDragEnd={() => setDragging(null)}
                          footer={<MoveSelect card={card} onMove={(to) => drop(card, to)} />}
                        />
                      ))
                    )}
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

function MoveSelect({ card, onMove }: { card: WorkshopCard; onMove: (to: ColumnKey) => void }) {
  if (card.allowedColumns.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-xs" onClick={(e) => e.stopPropagation()}>
      <Select
        aria-label={tw("board.moveLabel", { number: card.number })}
        value=""
        onChange={(e) => {
          const to = e.target.value as ColumnKey;
          if (to) onMove(to);
        }}
      >
        <option value="">{tw("board.moveTo")}</option>
        {card.allowedColumns.map((col) => (
          <option key={col} value={col}>
            {tw(`columns.${col}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}
