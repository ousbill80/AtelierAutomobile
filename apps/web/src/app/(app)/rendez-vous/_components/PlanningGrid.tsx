"use client";

import { useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { t } from "@/i18n/t";
import { SOURCE_ICONS, STATUS_META, TYPE_COLORS, statusLabel, typeLabel } from "../_lib/labels";
import {
  formatTime,
  minutesOfDay,
  openingRanges,
  toTime,
  type OpeningHoursMap,
} from "../_lib/time";
import type {
  PlanningAppointment,
  PlanningBay,
  PlanningBlock,
  PlanningMechanic,
} from "../_lib/types";

export const SLOT_HEIGHT = 28; // px par pas de 15 min
const STEP = 15;

export interface GridColumn {
  id: string;
  title: string;
  subtitle?: string;
  absent?: boolean;
  /** Vue par pont : `bayId` ; vue par mécanicien : `mechanicId` ; « À affecter » : null. */
  kind: "bay" | "mechanic" | "unassigned";
}

export interface PlanningGridProps {
  day: string;
  timeZone: string;
  openingHours: OpeningHoursMap;
  lunchBreak: [string, string] | null;
  columns: GridColumn[];
  appointments: PlanningAppointment[];
  blocks: PlanningBlock[];
  occupyingOrders: Array<{
    id: string;
    number: string;
    bayId: string | null;
    promisedAt: Date | null;
  }>;
  canUpdate: boolean;
  onSelect: (id: string) => void;
  onCreate: (startsAt: Date, bayId: string | null) => void;
  onMove: (input: {
    id: string;
    startsAt: Date;
    bayId?: string | null;
    mechanicId?: string | null;
    force: boolean;
  }) => void;
  onResize: (input: { id: string; durationMinutes: number }) => void;
}

function columnOf(appointment: PlanningAppointment, columns: GridColumn[]): string {
  const byBay = columns.find((c) => c.kind === "bay" && c.id === appointment.bayId);
  if (byBay) return byBay.id;
  const byMechanic = columns.find((c) => c.kind === "mechanic" && c.id === appointment.mechanicId);
  if (byMechanic) return byMechanic.id;
  return columns.find((c) => c.kind === "unassigned")?.id ?? columns[0]!.id;
}

/** Grille horaire jour (pas 15 min) : colonnes = ponts (+ « À affecter ») ou mécaniciens ; glisser-déposer et redimensionnement. */
export function PlanningGrid(props: PlanningGridProps) {
  const ranges = openingRanges(props.openingHours, props.day, props.lunchBreak);
  const dayStart = ranges.length > 0 ? Math.max(0, ranges[0]![0] - 60) : 7 * 60;
  const dayEnd =
    ranges.length > 0 ? Math.min(24 * 60, ranges[ranges.length - 1]![1] + 60) : 19 * 60;
  const rows = Math.ceil((dayEnd - dayStart) / STEP);
  const totalHeight = rows * SLOT_HEIGHT;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [altKey, setAltKey] = useState(false);

  const yToMinutes = (y: number) => dayStart + Math.round(y / SLOT_HEIGHT) * STEP;

  function handleDragEnd(event: DragEndEvent) {
    const appointment = event.active.data.current?.appointment as PlanningAppointment | undefined;
    const target = event.over?.data.current?.column as GridColumn | undefined;
    if (!appointment || !target) return;
    const startMinutes = minutesOfDay(appointment.startsAt, props.timeZone);
    const deltaMinutes = Math.round(event.delta.y / SLOT_HEIGHT) * STEP;
    const newMinutes = Math.max(0, Math.min(24 * 60 - STEP, startMinutes + deltaMinutes));
    const startsAt = new Date(
      appointment.startsAt.getTime() + (newMinutes - startMinutes) * 60_000,
    );
    const sameColumn = target.id === columnOf(appointment, props.columns);
    if (sameColumn && deltaMinutes === 0) return;
    props.onMove({
      id: appointment.id,
      startsAt,
      ...(target.kind === "bay"
        ? { bayId: target.id }
        : target.kind === "unassigned"
          ? { bayId: null }
          : { mechanicId: target.id }),
      force: altKey,
    });
  }

  const closedSegments: Array<[number, number]> = [];
  let cursor = dayStart;
  for (const [s, e] of ranges) {
    if (s > cursor) closedSegments.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < dayEnd) closedSegments.push([cursor, dayEnd]);
  if (ranges.length === 0) closedSegments.push([dayStart, dayEnd]);

  return (
    <div
      className="pl-grid-wrap"
      onKeyDown={(e) => e.altKey && setAltKey(true)}
      onKeyUp={() => setAltKey(false)}
      onPointerDown={(e) => setAltKey(e.altKey)}
      onPointerUp={(e) => setAltKey(e.altKey)}
    >
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div
          className="pl-grid"
          style={
            {
              ["--cols" as string]: props.columns.length,
              ["--slot-h" as string]: `${SLOT_HEIGHT}px`,
            } as CSSProperties
          }
        >
          <div className="corner" />
          {props.columns.map((col) => (
            <div key={col.id} className={["pl-col-head", col.absent ? "absent" : ""].join(" ")}>
              {col.title}
              {col.subtitle ? <small>{col.subtitle}</small> : null}
              {col.absent ? <small>{t("appointments.mechanicView.absent")}</small> : null}
            </div>
          ))}
          <div className="pl-time-col">
            {Array.from({ length: rows }, (_, i) => {
              const minutes = dayStart + i * STEP;
              return (
                <div
                  key={minutes}
                  className={["pl-time", minutes % 60 === 0 ? "" : "minor"].join(" ")}
                >
                  {toTime(minutes)}
                </div>
              );
            })}
          </div>
          {props.columns.map((col) => (
            <GridColumnView
              key={col.id}
              column={col}
              height={totalHeight}
              dayStart={dayStart}
              closedSegments={closedSegments}
              appointments={props.appointments.filter((a) => columnOf(a, props.columns) === col.id)}
              blocks={props.blocks.filter(
                (b) =>
                  (col.kind === "bay" && b.bayId === col.id) ||
                  (col.kind === "mechanic" && b.membershipId === col.id) ||
                  (b.bayId === null && b.membershipId === null),
              )}
              orders={
                col.kind === "bay" ? props.occupyingOrders.filter((o) => o.bayId === col.id) : []
              }
              timeZone={props.timeZone}
              yToMinutes={yToMinutes}
              day={props.day}
              canUpdate={props.canUpdate}
              onSelect={props.onSelect}
              onCreate={props.onCreate}
              onResize={props.onResize}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function GridColumnView(props: {
  column: GridColumn;
  height: number;
  dayStart: number;
  closedSegments: Array<[number, number]>;
  appointments: PlanningAppointment[];
  blocks: PlanningBlock[];
  orders: Array<{ id: string; number: string; promisedAt: Date | null }>;
  timeZone: string;
  day: string;
  yToMinutes: (y: number) => number;
  canUpdate: boolean;
  onSelect: (id: string) => void;
  onCreate: (startsAt: Date, bayId: string | null) => void;
  onResize: (input: { id: string; durationMinutes: number }) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: props.column.id,
    data: { column: props.column },
  });
  const ref = useRef<HTMLDivElement | null>(null);
  const top = (minutes: number) => ((minutes - props.dayStart) / STEP) * SLOT_HEIGHT;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".pl-card, .pl-block")) return;
    const rect = ref.current!.getBoundingClientRect();
    const minutes = props.dayStart + Math.floor((e.clientY - rect.top) / SLOT_HEIGHT) * STEP;
    const [y, m, d] = props.day.split("-").map(Number);
    const local = new Date(Date.UTC(y!, m! - 1, d!, Math.floor(minutes / 60), minutes % 60));
    // Convertit « heure locale du fuseau » en instant : décalage = instant(tz 00:00) − UTC 00:00.
    const offset = minutesOfDay(local, props.timeZone) - (minutes % (24 * 60));
    const startsAt = new Date(local.getTime() - offset * 60_000);
    props.onCreate(startsAt, props.column.kind === "bay" ? props.column.id : null);
  }

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        ref.current = node;
      }}
      className={["pl-col", isOver ? "over" : "", props.column.absent ? "absent" : ""].join(" ")}
      style={{ height: props.height }}
      onClick={props.column.absent ? undefined : handleClick}
      role="presentation"
    >
      {props.closedSegments.map(([s, e]) => (
        <div
          key={`${s}-${e}`}
          className="pl-closed"
          style={{ top: top(s), height: top(e) - top(s) }}
        />
      ))}
      {props.blocks.map((block) => {
        const s = Math.max(props.dayStart, minutesOfDay(block.startsAt, props.timeZone));
        const sameDay = block.startsAt.getTime() < block.endsAt.getTime();
        const e = Math.min(
          props.dayStart + (props.height / SLOT_HEIGHT) * STEP,
          block.endsAt.toISOString().slice(0, 10) > props.day
            ? 24 * 60
            : minutesOfDay(block.endsAt, props.timeZone),
        );
        if (!sameDay || e <= s) return null;
        return (
          <div
            key={block.id}
            className="pl-block"
            style={{ top: top(s), height: Math.max(SLOT_HEIGHT, top(e) - top(s)) }}
            title={block.reason}
          >
            ⛔ {block.reason}
          </div>
        );
      })}
      {props.orders.map((order) => (
        <div
          key={order.id}
          className="pl-block"
          style={{
            top: 0,
            height: order.promisedAt
              ? Math.max(SLOT_HEIGHT, top(minutesOfDay(order.promisedAt, props.timeZone)))
              : props.height,
          }}
          title={order.number}
        >
          🔧 {order.number}
        </div>
      ))}
      {props.appointments.map((appointment) => (
        <AppointmentCard
          key={appointment.id}
          appointment={appointment}
          top={top}
          timeZone={props.timeZone}
          canUpdate={props.canUpdate}
          onSelect={props.onSelect}
          onResize={props.onResize}
        />
      ))}
    </div>
  );
}

function AppointmentCard(props: {
  appointment: PlanningAppointment;
  top: (minutes: number) => number;
  timeZone: string;
  canUpdate: boolean;
  onSelect: (id: string) => void;
  onResize: (input: { id: string; durationMinutes: number }) => void;
}) {
  const a = props.appointment;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: a.id,
    data: { appointment: a },
    disabled: !props.canUpdate || a.status === "CANCELLED" || a.status === "COMPLETED",
  });
  const start = minutesOfDay(a.startsAt, props.timeZone);
  const height = Math.max(SLOT_HEIGHT, (a.durationMinutes / STEP) * SLOT_HEIGHT);
  const style: CSSProperties = {
    top: props.top(start),
    height: height - 2,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    ["--type-color" as string]: TYPE_COLORS[a.type],
  };
  const resizing = useRef<{ startY: number; duration: number } | null>(null);

  function startResize(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    resizing.current = { startY: e.clientY, duration: a.durationMinutes };
    const move = (ev: PointerEvent) => {
      if (!resizing.current) return;
      const delta = Math.round((ev.clientY - resizing.current.startY) / SLOT_HEIGHT) * STEP;
      const next = Math.max(STEP, resizing.current.duration + delta);
      (e.currentTarget.parentElement as HTMLElement).style.height =
        `${(next / STEP) * SLOT_HEIGHT - 2}px`;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!resizing.current) return;
      const delta = Math.round((ev.clientY - resizing.current.startY) / SLOT_HEIGHT) * STEP;
      const next = Math.max(STEP, resizing.current.duration + delta);
      resizing.current = null;
      if (next !== a.durationMinutes) props.onResize({ id: a.id, durationMinutes: next });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "pl-card",
        `status-${a.status}`,
        a.flags.late ? "late" : "",
        isDragging ? "dragging" : "",
        a.durationMinutes <= 30 ? "compact" : "",
      ].join(" ")}
      style={style}
      {...listeners}
      {...attributes}
      tabIndex={0}
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        props.onSelect(a.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onSelect(a.id);
      }}
      title={`${formatTime(a.startsAt, props.timeZone)}–${formatTime(a.endsAt, props.timeZone)} ${a.customer.displayName}`}
    >
      <div className="head">
        <span className="time">{formatTime(a.startsAt, props.timeZone)}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {a.customer.displayName}
        </span>
      </div>
      <div className="veh">
        {a.vehicle
          ? `${a.vehicle.make} ${a.vehicle.model} · ${a.vehicle.plate}`
          : t("appointments.fields.noVehicle")}
      </div>
      <div className="meta">
        <span className="pl-type">
          <span className="sw" />
          {typeLabel(a.type)}
        </span>
        <span className="pl-status" title={statusLabel(a.status)}>
          {STATUS_META[a.status].icon} {statusLabel(a.status)}
        </span>
        <span className="pl-src" title={a.source}>
          {SOURCE_ICONS[a.source]}
        </span>
        {a.overbooked ? (
          <span className="pl-flag" title={t("appointments.badges.overbooked")}>
            ⚠
          </span>
        ) : null}
        {a.flags.noShowCount12m >= 2 ? (
          <span className="pl-flag bad">
            {t("appointments.badges.noShows", { count: a.flags.noShowCount12m })}
          </span>
        ) : null}
        {a.flags.inspectionStatus === "DUE_SOON" || a.flags.inspectionStatus === "EXPIRED" ? (
          <span className="pl-flag">{t("appointments.badges.inspectionSoon")}</span>
        ) : null}
      </div>
      {props.canUpdate && (a.status === "BOOKED" || a.status === "CONFIRMED") ? (
        <div className="resize" onPointerDown={startResize} aria-hidden="true" />
      ) : null}
    </div>
  );
}

export function mechanicColumns(
  mechanics: PlanningMechanic[],
  blocks: PlanningBlock[],
  appointments: PlanningAppointment[],
  availableMinutes: number,
): GridColumn[] {
  return mechanics.map((m) => {
    const absent = blocks.some((b) => b.membershipId === m.membershipId);
    const planned = appointments
      .filter(
        (a) =>
          a.mechanicId === m.membershipId && a.status !== "CANCELLED" && a.status !== "NO_SHOW",
      )
      .reduce((sum, a) => sum + a.durationMinutes, 0);
    return {
      id: m.membershipId,
      kind: "mechanic",
      title: m.name,
      subtitle: t("appointments.mechanicView.load", {
        planned: formatHours(planned),
        available: formatHours(availableMinutes),
      }),
      absent,
    };
  });
}

export function bayColumns(bays: PlanningBay[]): GridColumn[] {
  return [
    ...bays.map((b) => ({ id: b.id, kind: "bay" as const, title: b.name, subtitle: b.type })),
    {
      id: "__unassigned",
      kind: "unassigned" as const,
      title: t("appointments.fields.unassignedBay"),
    },
  ];
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
