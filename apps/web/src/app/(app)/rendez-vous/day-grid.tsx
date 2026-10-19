"use client";

// §7 — grille horaire (pas 15 min) : colonnes = ponts actifs + « À affecter » (ou mécaniciens).
// Clic sur un créneau vide → création ; clic sur un RDV → panneau ; glisser-déposer (HTML5,
// Alt = surréservation pour planning:manage) ; étirement du bord bas par pas de 15 min.
// Blocs gris hachurés : indisponibilités, fermetures, OR en cours occupant un pont.
import {
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { localMinutes } from "@atelieros/core/planning";
import {
  SourceIcon,
  STATUS_META,
  TYPE_COLORS,
  fmtTime,
  ta,
  type AppointmentSource,
  type AppointmentStatus,
  type AppointmentType,
} from "./labels";
import type { PlanningAppointment } from "./types";

export const SLOT_PX = 16; // hauteur d'un pas de 15 min
const STEP = 15;

export interface GridColumn {
  key: string; // id du pont / mécanicien, "" = À affecter
  label: string;
  header?: ReactNode;
  disabled?: boolean;
}

export interface GridBlock {
  id: string;
  columnKey: string | "*";
  startMin: number;
  endMin: number;
  label: string;
}

export function DayGrid({
  columns,
  appointments,
  columnOf,
  blocks,
  closed,
  range,
  timeZone,
  canDrag,
  onSlotClick,
  onSelect,
  onMove,
  onResize,
}: {
  columns: GridColumn[];
  appointments: PlanningAppointment[];
  columnOf: (a: PlanningAppointment) => string;
  blocks: GridBlock[];
  closed: Array<[number, number]>;
  range: [number, number];
  timeZone: string;
  canDrag: boolean;
  onSlotClick: (columnKey: string, minutes: number) => void;
  onSelect: (id: string) => void;
  onMove: (id: string, columnKey: string, minutes: number, altKey: boolean) => void;
  onResize: (id: string, durationMinutes: number) => void;
}) {
  const [start, end] = range;
  const height = ((end - start) / STEP) * SLOT_PX;
  const grabOffset = useRef(0);
  const [resizing, setResizing] = useState<{ id: string; duration: number } | null>(null);
  const hours: number[] = [];
  for (let m = Math.ceil(start / 60) * 60; m < end; m += 60) hours.push(m);

  const toY = (minutes: number) => ((minutes - start) / STEP) * SLOT_PX;
  const yToMinutes = (y: number) => start + Math.round(y / SLOT_PX) * STEP;

  function handleDrop(e: DragEvent<HTMLDivElement>, column: GridColumn) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id || column.disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = Math.max(start, yToMinutes(e.clientY - rect.top - grabOffset.current));
    onMove(id, column.key, minutes, e.altKey);
  }

  function startResize(e: ReactPointerEvent<HTMLDivElement>, a: PlanningAppointment) {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const initial = a.durationMinutes;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    let current = initial;
    const move = (ev: PointerEvent) => {
      current = Math.max(STEP, initial + Math.round((ev.clientY - startY) / SLOT_PX) * STEP);
      setResizing({ id: a.id, duration: current });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      setResizing(null);
      if (current !== initial) onResize(a.id, current);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="day-grid">
      <div className="inline-flex min-w-full">
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-surface">
          <div className="h-14 border-b border-border" />
          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <span
                key={m}
                className="absolute right-1 -translate-y-1/2 text-[11px] text-muted"
                style={{ top: toY(m) }}
              >
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>
        {columns.map((column) => (
          <div
            key={column.key || "unassigned"}
            className="min-w-[150px] flex-1 border-r border-border last:border-r-0"
          >
            <div
              className={`sticky top-0 z-10 flex h-14 flex-col justify-center border-b border-border px-2 ${column.disabled ? "bg-surface-2 text-muted" : "bg-surface"}`}
            >
              <span className="truncate text-sm font-semibold">{column.label}</span>
              {column.header}
            </div>
            <div
              role="grid"
              aria-label={column.label}
              data-column={column.key || "unassigned"}
              className={`relative ${column.disabled ? "cursor-not-allowed bg-surface-2" : "cursor-pointer"}`}
              style={{
                height,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${SLOT_PX * 4 - 1}px, var(--border) ${SLOT_PX * 4 - 1}px, var(--border) ${SLOT_PX * 4}px)`,
              }}
              onClick={(e) => {
                if (column.disabled || e.target !== e.currentTarget) return;
                const rect = e.currentTarget.getBoundingClientRect();
                onSlotClick(
                  column.key,
                  Math.floor((e.clientY - rect.top) / SLOT_PX) * STEP + start,
                );
              }}
              onDragOver={(e) => {
                if (!column.disabled) e.preventDefault();
              }}
              onDrop={(e) => handleDrop(e, column)}
            >
              {closed.map(([from, to]) => (
                <div
                  key={`c-${from}`}
                  className="pointer-events-none absolute inset-x-0 bg-surface-2/80"
                  style={{ top: toY(from), height: toY(to) - toY(from) }}
                  aria-label={ta("closed")}
                />
              ))}
              {blocks
                .filter((b) => b.columnKey === "*" || b.columnKey === column.key)
                .map((b) => (
                  <div
                    key={`${b.id}-${column.key}`}
                    className="pointer-events-none absolute inset-x-0 z-[1] overflow-hidden border-y border-border px-1 text-[11px] text-muted"
                    style={{
                      top: toY(Math.max(start, b.startMin)),
                      height: toY(Math.min(end, b.endMin)) - toY(Math.max(start, b.startMin)),
                      backgroundImage:
                        "repeating-linear-gradient(45deg, var(--surface-2) 0 6px, transparent 6px 12px)",
                    }}
                  >
                    {b.label}
                  </div>
                ))}
              {appointments
                .filter((a) => columnOf(a) === column.key && a.status !== "CANCELLED")
                .map((a) => {
                  const startMin = localMinutes(new Date(a.startsAt), timeZone);
                  const duration = resizing?.id === a.id ? resizing.duration : a.durationMinutes;
                  const status = a.status as AppointmentStatus;
                  const meta = STATUS_META[status];
                  const Icon = meta.Icon;
                  const draggable = canDrag && (status === "BOOKED" || status === "CONFIRMED");
                  return (
                    <div
                      key={a.id}
                      data-testid="appt-card"
                      data-appointment-id={a.id}
                      draggable={draggable}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", a.id);
                        e.dataTransfer.effectAllowed = "move";
                        grabOffset.current =
                          e.clientY - e.currentTarget.getBoundingClientRect().top;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(a.id);
                      }}
                      className={`absolute inset-x-1 z-[2] overflow-hidden rounded-md border bg-surface px-2 py-1 text-xs shadow-sm ${a.flags.late ? "border-status-bad" : "border-border"} ${draggable ? "cursor-grab" : "cursor-pointer"}`}
                      style={{
                        top: toY(startMin),
                        height: Math.max(SLOT_PX * 2 - 2, (duration / STEP) * SLOT_PX - 2),
                        borderLeft: `4px solid ${TYPE_COLORS[a.type as AppointmentType]}`,
                      }}
                    >
                      <div className="flex items-center gap-1 font-semibold">
                        <span>{fmtTime(a.startsAt, timeZone)}</span>
                        <Icon
                          size={12}
                          aria-label={ta(`statuses.${status}`)}
                          style={{ color: meta.color }}
                        />
                        <SourceIcon source={a.source as AppointmentSource} />
                        {a.overbooked && (
                          <AlertTriangle
                            size={12}
                            aria-label={ta("badges.overbooked")}
                            className="text-status-warn"
                          />
                        )}
                      </div>
                      <div className="truncate font-medium">{a.customer.displayName}</div>
                      {a.vehicle && (
                        <div className="truncate text-muted">
                          {a.vehicle.model} {a.vehicle.plate}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-1">
                        <span className="truncate">{ta(`types.${a.type}`)}</span>
                        {a.flags.noShowCount >= 2 && (
                          <span className="text-status-bad">
                            · {ta("badges.noShows", { count: a.flags.noShowCount })}
                          </span>
                        )}
                        {a.flags.inspectionSoon && (
                          <span className="text-status-warn">· {ta("badges.inspectionSoon")}</span>
                        )}
                        {a.flags.late && (
                          <span className="text-status-bad">· {ta("badges.late")}</span>
                        )}
                      </div>
                      {draggable && (
                        <div
                          aria-hidden
                          data-testid="resize-handle"
                          onPointerDown={(e) => startResize(e, a)}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
