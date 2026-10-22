"use client";

// M03 §7 `/(app)/rendez-vous` — Planning : sélecteur de date, vues Jour par pont / Jour par
// mécanicien / Semaine / Liste, filtres type/statut/source, bandeau de capacité, panneau RDV.
// Mobile : vue Liste par défaut, glisser-déposer remplacé par « Déplacer » (panneau).
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Phone, Plus } from "lucide-react";
import { Button, Select } from "@atelieros/ui";
import {
  addDaysToKey,
  formatMinutesFr,
  localDateKey,
  localMinutes,
  openIntervalsForDay,
  overlapMinutes,
  startOfWeekKey,
  type OpeningHours,
} from "@atelieros/core/planning";
import { trpc } from "@/trpc/react";
import { AppointmentForm, type AppointmentFormInitial } from "./appointment-form";
import { AppointmentPanel } from "./appointment-panel";
import { AppointmentRow } from "./appointment-row";
import { DayGrid, type GridBlock, type GridColumn } from "./day-grid";
import {
  SOURCES,
  STATUSES,
  TYPES,
  errorInfo,
  fmtDay,
  fmtTime,
  instantOf,
  ta,
  type AppointmentSource,
  type AppointmentStatus,
  type AppointmentType,
} from "./labels";
import type { CapacityRow, PlanningAppointment, PlanningList } from "./types";
import { ErrorBox, SidePanel, Toast, type ToastState } from "./ui-bits";

type View = "bay" | "mechanic" | "week" | "list";
const VIEWS: View[] = ["bay", "mechanic", "week", "list"];
const DEFAULT_TZ = "Africa/Abidjan";
const MOBILE_QUERY = "(max-width: 760px)";

function subscribeMobile(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const isMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;

function dayRange(openingHours: OpeningHours, dayKey: string): [number, number] {
  const intervals = openIntervalsForDay(dayKey, { timeZone: DEFAULT_TZ, openingHours });
  if (intervals.length === 0) return [7 * 60 + 30, 18 * 60];
  return [
    Math.floor(intervals[0]![0] / 60) * 60,
    Math.ceil(intervals[intervals.length - 1]![1] / 60) * 60,
  ];
}

/** Plages fermées de la grille (avant ouverture, pause, après fermeture). */
function closedRanges(
  openingHours: OpeningHours,
  dayKey: string,
  range: [number, number],
): Array<[number, number]> {
  const intervals = openIntervalsForDay(dayKey, { timeZone: DEFAULT_TZ, openingHours });
  if (intervals.length === 0) return [range];
  const closed: Array<[number, number]> = [];
  let cursor = range[0];
  for (const [from, to] of intervals) {
    if (from > cursor) closed.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < range[1]) closed.push([cursor, range[1]]);
  return closed;
}

function minutesWithinDay(date: Date | string, dayKey: string, tz: string, edge: "start" | "end") {
  const d = new Date(date);
  const key = localDateKey(d, tz);
  if (key < dayKey) return 0;
  if (key > dayKey) return 24 * 60;
  const m = localMinutes(d, tz);
  return edge === "end" && m === 0 ? 24 * 60 : m;
}

export default function PlanningPage() {
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const permissions = useMemo(() => new Set<string>(me.data?.permissions ?? []), [me.data]);
  const tz = me.data?.activeOrganization?.timezone ?? DEFAULT_TZ;
  const [dayKey, setDayKey] = useState(() => localDateKey(new Date(), DEFAULT_TZ));
  // Mobile (≤ 760 px) : vue Liste par défaut tant que l'utilisateur n'a pas choisi (§7).
  const isMobile = useSyncExternalStore(subscribeMobile, isMobileSnapshot, () => false);
  const [viewChoice, setView] = useState<View | null>(null);
  const view: View = viewChoice ?? (isMobile ? "list" : "bay");
  const [typeFilter, setTypeFilter] = useState<AppointmentType | "">("");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "">("");
  const [sourceFilter, setSourceFilter] = useState<AppointmentSource | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<AppointmentFormInitial | null>(null);
  const [notifyOnMove, setNotifyOnMove] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);

  const weekStart = startOfWeekKey(dayKey);
  const rangeFrom = view === "week" ? weekStart : dayKey;
  const rangeTo = view === "week" ? addDaysToKey(weekStart, 6) : dayKey;
  const listInput = useMemo(
    () => ({
      from: instantOf(rangeFrom, "00:00", tz),
      to: instantOf(addDaysToKey(rangeTo, 1), "00:00", tz),
      types: typeFilter ? [typeFilter] : undefined,
      statuses: statusFilter ? [statusFilter] : undefined,
      sources: sourceFilter ? [sourceFilter] : undefined,
    }),
    [rangeFrom, rangeTo, tz, typeFilter, statusFilter, sourceFilter],
  );
  const list = trpc.appointment.list.useQuery(listInput);
  const capacity = trpc.planning.capacity.useQuery(
    { siteId: list.data?.site.id, from: rangeFrom, to: rangeTo },
    { enabled: !!list.data },
  );

  const showToast = useCallback(
    (message: string, tone: "ok" | "bad" = "ok") => setToast({ message, tone }),
    [],
  );
  const clearToast = useCallback(() => setToast(null), []);

  const update = trpc.appointment.update.useMutation({
    onSuccess(result) {
      showToast(result.warnings.length ? result.warnings.join(" ") : ta("moved"));
      utils.appointment.invalidate();
      utils.planning.invalidate();
    },
    onError(e) {
      showToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
      void list.refetch();
    },
  });

  const canForce = permissions.has("planning:manage");
  const canUpdate = permissions.has("appointment:update");
  const canCreate = permissions.has("appointment:create");

  const data = list.data;
  const openingHours = (data?.site.openingHours ?? {}) as OpeningHours;
  const range = dayRange(openingHours, dayKey);
  const closed = closedRanges(openingHours, dayKey, range);

  function moveAppointment(
    id: string,
    columnKey: string,
    minutes: number,
    altKey: boolean,
    by: "bay" | "mechanic",
  ) {
    const startsAt = instantOf(
      dayKey,
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
      tz,
    );
    update.mutate({
      id,
      startsAt,
      ...(by === "bay" ? { bayId: columnKey || null } : { mechanicId: columnKey || null }),
      notifyCustomer: notifyOnMove,
      force: altKey && canForce,
    });
  }

  function gridBlocks(by: "bay" | "mechanic"): GridBlock[] {
    if (!data) return [];
    const blocks: GridBlock[] = data.blocks
      .filter((b) => (by === "bay" ? !b.membershipId : !b.bayId))
      .map((b) => ({
        id: b.id,
        columnKey: by === "bay" ? (b.bayId ?? "*") : (b.membershipId ?? "*"),
        startMin: minutesWithinDay(b.startsAt, dayKey, tz, "start"),
        endMin: minutesWithinDay(b.endsAt, dayKey, tz, "end"),
        label: `${ta("blocked")} — ${b.reason}`,
      }));
    if (by === "bay") {
      for (const o of data.occupyingOrders) {
        blocks.push({
          id: o.id,
          columnKey: o.bayId,
          startMin: minutesWithinDay(o.startsAt, dayKey, tz, "start"),
          endMin: minutesWithinDay(o.endsAt, dayKey, tz, "end"),
          label: `${ta("repairOrderBlock")} ${o.label ?? ""}`,
        });
      }
    }
    return blocks;
  }

  const dayCapacity = (capacity.data ?? []).filter((r) => r.date === dayKey);

  return (
    <div className="planning-page">
      {/* Header */}
      <div className="planning-header">
        <h1>{ta("title")}</h1>
        <div className="planning-header-actions">
          <Link href="/rendez-vous/aujourdhui" className="btn btn-secondary">
            {ta("todayPage.title")}
          </Link>
          {canCreate && (
            <>
              <Button
                variant="secondary"
                onClick={() => setCreating({ source: "PHONE" })}
              >
                <Phone size={16} aria-hidden /> {ta("phoneAppointment")}
              </Button>
              <Button onClick={() => setCreating({})}>
                <Plus size={16} aria-hidden /> {ta("newAppointment")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Date navigation */}
      <div className="planning-date-nav">
        <button
          type="button"
          aria-label={ta("previous")}
          className="planning-nav-btn"
          onClick={() => setDayKey(addDaysToKey(dayKey, view === "week" ? -7 : -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="planning-today-btn"
          onClick={() => setDayKey(localDateKey(new Date(), tz))}
        >
          {ta("today")}
        </button>
        <button
          type="button"
          aria-label={ta("next")}
          className="planning-nav-btn"
          onClick={() => setDayKey(addDaysToKey(dayKey, view === "week" ? 7 : 1))}
        >
          <ChevronRight size={18} />
        </button>
        <input
          type="date"
          aria-label={ta("form.date")}
          value={dayKey}
          onChange={(e) => e.target.value && setDayKey(e.target.value)}
          className="planning-date-input"
        />
        <span className="planning-date-label" data-testid="planning-date">
          {view === "week"
            ? `${fmtDay(instantOf(weekStart, "12:00", tz), tz)} → ${fmtDay(instantOf(rangeTo, "12:00", tz), tz)}`
            : fmtDay(instantOf(dayKey, "12:00", tz), tz)}
        </span>
      </div>

      {/* View tabs */}
      <div className="planning-tabs" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`planning-tab ${view === v ? "active" : ""}`}
          >
            {ta(`views.${v}`)}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="planning-filters">
        <Select
          aria-label={ta("filters.allTypes")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AppointmentType | "")}
        >
          <option value="">{ta("filters.allTypes")}</option>
          {TYPES.map((v) => (
            <option key={v} value={v}>
              {ta(`types.${v}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={ta("filters.allStatuses")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | "")}
        >
          <option value="">{ta("filters.allStatuses")}</option>
          {STATUSES.map((v) => (
            <option key={v} value={v}>
              {ta(`statuses.${v}`)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={ta("filters.allSources")}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as AppointmentSource | "")}
        >
          <option value="">{ta("filters.allSources")}</option>
          {SOURCES.map((v) => (
            <option key={v} value={v}>
              {ta(`sources.${v}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Capacity */}
      {(view === "bay" || view === "mechanic") && dayCapacity.length > 0 && (
        <div className="planning-capacity" data-testid="capacity-banner">
          {dayCapacity.map((row) => (
            <CapacityGauge key={row.halfDay} row={row} />
          ))}
        </div>
      )}

      {list.isLoading && (
        <div className="planning-loading" aria-busy>
          <div className="planning-loading-spinner" />
          <p>Chargement du planning...</p>
        </div>
      )}
      {list.isError && <ErrorBox message={ta("loadError")} onRetry={() => list.refetch()} />}

      {data && (view === "bay" || view === "mechanic") && (
        <>
          {canUpdate && (
            <div className="planning-hint">
              <label>
                <input
                  type="checkbox"
                  checked={notifyOnMove}
                  onChange={(e) => setNotifyOnMove(e.target.checked)}
                />
                {ta("notifyOnMove")}
              </label>
              <span className="hidden md:inline">{ta("dragHint")}</span>
              {canForce && <span className="hidden md:inline">{ta("altHint")}</span>}
            </div>
          )}
          {data.appointments.length === 0 && (
            <div className="planning-empty">
              <p>{ta("empty")}</p>
            </div>
          )}
          {view === "bay" ? (
            data.bays.length === 0 ? (
              <p className="text-sm text-muted">{ta("noBays")}</p>
            ) : (
              <DayGrid
                columns={[
                  ...data.bays.map((b): GridColumn => ({ key: b.id, label: b.name })),
                  { key: "", label: ta("unassigned") },
                ]}
                appointments={data.appointments}
                columnOf={(a) => a.bayId ?? ""}
                blocks={gridBlocks("bay")}
                closed={closed}
                range={range}
                timeZone={tz}
                canDrag={canUpdate}
                onSlotClick={(bayId, minutes) =>
                  canCreate &&
                  setCreating({
                    bayId: bayId || null,
                    startsAt: instantOf(
                      dayKey,
                      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
                      tz,
                    ),
                  })
                }
                onSelect={setSelected}
                onMove={(id, key, minutes, alt) => moveAppointment(id, key, minutes, alt, "bay")}
                onResize={(id, durationMinutes) =>
                  update.mutate({ id, durationMinutes, notifyCustomer: false, force: false })
                }
              />
            )
          ) : (
            <MechanicGrid
              data={data}
              dayKey={dayKey}
              tz={tz}
              range={range}
              closed={closed}
              blocks={gridBlocks("mechanic")}
              canDrag={canUpdate}
              onSelect={setSelected}
              onSlotClick={(mechanicId, minutes) =>
                canCreate &&
                setCreating({
                  mechanicId: mechanicId || null,
                  startsAt: instantOf(
                    dayKey,
                    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
                    tz,
                  ),
                })
              }
              onMove={(id, key, minutes, alt) => moveAppointment(id, key, minutes, alt, "mechanic")}
              onResize={(id, durationMinutes) =>
                update.mutate({ id, durationMinutes, notifyCustomer: false, force: false })
              }
            />
          )}
        </>
      )}

      {data && view === "week" && (
        <WeekView
          data={data}
          capacity={capacity.data ?? []}
          weekStart={weekStart}
          tz={tz}
          onOpenDay={(key) => {
            setDayKey(key);
            setView("bay");
          }}
          onSelect={setSelected}
        />
      )}

      {data && view === "list" && <ListView data={data} tz={tz} onSelect={setSelected} />}

      <SidePanel open={!!selected} title={ta("panel.title")} onClose={() => setSelected(null)}>
        {selected && (
          <AppointmentPanel
            id={selected}
            permissions={permissions}
            onToast={showToast}
            onChanged={() => void list.refetch()}
          />
        )}
      </SidePanel>

      <SidePanel open={!!creating} title={ta("form.title")} onClose={() => setCreating(null)}>
        {creating && (
          <AppointmentForm
            initial={creating}
            siteId={data?.site.id}
            timeZone={tz}
            onCancel={() => setCreating(null)}
            onDone={(result) => {
              setCreating(null);
              showToast(
                [
                  result.notified ? ta("form.created") : ta("form.createdNoChannel"),
                  ...result.warnings,
                ].join(" "),
              );
            }}
          />
        )}
      </SidePanel>

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}

function CapacityGauge({ row }: { row: CapacityRow }) {
  const half = ta(`halfDay.${row.halfDay}`);
  const ratio = row.capacityMinutes ? row.loadMinutes / row.capacityMinutes : row.occupancy;
  const tone = ratio > 0.9 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
  const label =
    row.capacityMinutes !== null
      ? ta("capacity", {
          half,
          load: formatMinutesFr(row.loadMinutes),
          capacity: formatMinutesFr(row.capacityMinutes),
        })
      : ta("capacityUnknown", { half, load: formatMinutesFr(row.loadMinutes) });
  return (
    <div className="planning-capacity-card">
      <div className="planning-capacity-label">
        {label} · {ta("appointmentsCount", { count: row.appointmentsCount })}
      </div>
      <div className="planning-capacity-bar">
        <div
          className={`planning-capacity-fill ${tone}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function MechanicGrid({
  data,
  dayKey,
  tz,
  range,
  closed,
  blocks,
  canDrag,
  onSelect,
  onSlotClick,
  onMove,
  onResize,
}: {
  data: PlanningList;
  dayKey: string;
  tz: string;
  range: [number, number];
  closed: Array<[number, number]>;
  blocks: GridBlock[];
  canDrag: boolean;
  onSelect: (id: string) => void;
  onSlotClick: (key: string, minutes: number) => void;
  onMove: (id: string, key: string, minutes: number, alt: boolean) => void;
  onResize: (id: string, duration: number) => void;
}) {
  if (data.mechanics.length === 0) return <p className="text-sm text-muted">{ta("noMechanics")}</p>;
  const openingHours = (data.site.openingHours ?? {}) as OpeningHours;
  const open = openIntervalsForDay(dayKey, { timeZone: tz, openingHours });
  const openMinutes = open.reduce((s, [a, b]) => s + (b - a), 0);
  const columns: GridColumn[] = data.mechanics.map((m) => {
    const blocked = data.blocks
      .filter((b) => b.membershipId === m.id)
      .reduce((sum, b) => {
        const interval = { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt) };
        return (
          sum +
          open.reduce(
            (s, [from, to]) =>
              s +
              overlapMinutes(interval, {
                startsAt: instantOf(dayKey, hhmm(from), tz),
                endsAt: instantOf(dayKey, hhmm(to), tz),
              }),
            0,
          )
        );
      }, 0);
    const available = Math.max(0, openMinutes - blocked);
    const planned = data.appointments
      .filter((a) => a.mechanicId === m.id && a.status !== "CANCELLED" && a.status !== "NO_SHOW")
      .reduce((s, a) => s + a.durationMinutes, 0);
    const ratio = available ? planned / available : 1;
    const tone = ratio > 0.9 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
    const label = available === 0
      ? ta("mechanicAbsent")
      : ta("mechanicLoad", {
          planned: formatMinutesFr(planned),
          available: formatMinutesFr(available),
        });
    return {
      key: m.id,
      label: m.name,
      disabled: available === 0,
      header: (
        <div className="planning-mechanic-gauge">
          <div className="planning-capacity-label">{label}</div>
          <div className="planning-capacity-bar">
            <div
              className={`planning-capacity-fill ${tone}`}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>
        </div>
      ),
    };
  });
  columns.push({ key: "", label: ta("unassigned") });
  return (
    <DayGrid
      columns={columns}
      appointments={data.appointments}
      columnOf={(a) => a.mechanicId ?? ""}
      blocks={blocks}
      closed={closed}
      range={range}
      timeZone={tz}
      canDrag={canDrag}
      onSlotClick={onSlotClick}
      onSelect={onSelect}
      onMove={onMove}
      onResize={onResize}
    />
  );
}

function hhmm(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function WeekView({
  data,
  capacity,
  weekStart,
  tz,
  onOpenDay,
  onSelect,
}: {
  data: PlanningList;
  capacity: CapacityRow[];
  weekStart: string;
  tz: string;
  onOpenDay: (key: string) => void;
  onSelect: (id: string) => void;
}) {
  const bays = Math.max(1, data.bays.length);
  if (data.appointments.length === 0) {
    return (
      <div className="planning-empty">
        <p>{ta("emptyWeek")}</p>
      </div>
    );
  }
  return (
    <div className="planning-week" data-testid="week-view">
      {Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i)).map((key) => {
        const rows = capacity.filter((r) => r.date === key);
        const load = rows.reduce((s, r) => s + r.loadMinutes, 0);
        const openMinutes = rows.reduce((s, r) => s + r.openMinutes, 0) * bays;
        const ratio = openMinutes ? load / openMinutes : 0;
        const tone = ratio > 0.9 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
        const items = data.appointments.filter(
          (a) => localDateKey(new Date(a.startsAt), tz) === key && a.status !== "CANCELLED",
        );
        return (
          <div key={key} className="planning-week-day">
            <button
              type="button"
              onClick={() => onOpenDay(key)}
              className="planning-week-day-header"
            >
              {fmtDay(instantOf(key, "12:00", tz), tz)}
            </button>
            <div className="planning-week-day-count">
              {ta("appointmentsCount", { count: items.length })}
            </div>
            <div className="planning-capacity-bar" style={{ marginBottom: 12 }}>
              <div
                className={`planning-capacity-fill ${tone}`}
                style={{ width: `${Math.min(ratio * 100, 100)}%` }}
              />
            </div>
            <div>
              {items.slice(0, 5).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className="planning-week-item"
                >
                  <span className="planning-week-item-time">{fmtTime(a.startsAt, tz)}</span>{" "}
                  <span className="planning-week-item-name">{a.customer.displayName}</span>
                </button>
              ))}
              {items.length > 5 && (
                <div className="planning-week-item" style={{ color: "var(--muted)", cursor: "default" }}>
                  +{items.length - 5} autres
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  data,
  tz,
  onSelect,
}: {
  data: PlanningList;
  tz: string;
  onSelect: (id: string) => void;
}) {
  if (data.appointments.length === 0) {
    return (
      <div className="planning-empty">
        <p>{ta("empty")}</p>
      </div>
    );
  }
  const groups = new Map<string, PlanningAppointment[]>();
  for (const a of data.appointments) {
    const d = new Date(a.startsAt);
    const key = `${localDateKey(d, tz)}|${localMinutes(d, tz) < data.halfDayBoundaryMinutes ? "AM" : "PM"}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return (
    <div className="planning-list" data-testid="list-view">
      {[...groups.entries()].map(([key, items]) => {
        const [day, half] = key.split("|");
        return (
          <div key={key} className="planning-list-group">
            <div className="planning-list-group-header">
              {fmtDay(instantOf(day!, "12:00", tz), tz)} · {ta(`halfDay.${half}`)}
            </div>
            {items.map((a) => (
              <AppointmentRow key={a.id} a={a} tz={tz} onSelect={onSelect} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
