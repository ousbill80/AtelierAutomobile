"use client";

// M06 US-M06-01 — /atelier : kanban des OR par étape (RG-M06-01), bandeau des retards
// (RG-M06-02), glisser-déposer contrôlé par les transitions M04 (colonnes grisées), sélecteur
// « Déplacer vers… » pour le tactile. Mobile : colonnes en onglets horizontaux.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
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

  const columns = board.data?.columns ?? [];
  const total = columns.reduce((s, c) => s + c.cards.length, 0);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHead title={tw("title")} description={tw("board.description")} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {tw("board.priority")}
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
            <option value="">{tw("board.allPriorities")}</option>
            {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => (
              <option key={p} value={p}>
                {tw(`priorityLabels.${p}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tw("board.mechanic")}
          <Select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
            <option value="">{tw("board.allMechanics")}</option>
            {mechanics.data?.mechanics.map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={lateOnly}
            onChange={(e) => setLateOnly(e.target.checked)}
          />
          {tw("board.lateOnly")}
        </label>
      </div>

      {board.data && board.data.lateCount > 0 ? (
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
                    className={`min-h-11 rounded-md px-3 text-sm ${
                      mobileColumn === col.key ? "bg-accent text-accent-foreground" : "bg-surface-2"
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
                    className={`flex min-h-64 flex-col gap-2 rounded-lg p-2 transition-opacity ${
                      dragging && !allowed && !isSource
                        ? "bg-surface-2 opacity-40"
                        : "bg-surface-2/60"
                    }`}
                  >
                    <h3 className="flex items-center justify-between text-sm font-semibold">
                      {tw(`columns.${col.key}`)}
                      <span className="text-xs text-muted">
                        {tw("board.count", { count: col.cards.length })}
                      </span>
                    </h3>
                    {col.cards.length === 0 ? (
                      <p className="text-xs text-muted">{tw("board.empty")}</p>
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
      {move.isPending ? <p className="text-sm text-muted">{tw("loading")}</p> : null}
    </div>
  );
}

function MoveSelect({ card, onMove }: { card: WorkshopCard; onMove: (to: ColumnKey) => void }) {
  if (card.allowedColumns.length === 0) return null;
  return (
    <Select
      aria-label={tw("board.moveLabel", { number: card.number })}
      value=""
      onChange={(e) => {
        if (e.target.value) onMove(e.target.value as ColumnKey);
      }}
    >
      <option value="">{tw("board.moveTo")}</option>
      {card.allowedColumns.map((key) => (
        <option key={key} value={key}>
          {tw(`columns.${key}`)}
        </option>
      ))}
    </Select>
  );
}
