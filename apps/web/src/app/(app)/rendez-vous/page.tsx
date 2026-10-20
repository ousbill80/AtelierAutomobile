"use client";

// M03 §7 `/(app)/rendez-vous` — Planning & Rendez-vous : KPIs interactifs, filtres temporels
// rapides, recherche multi-critères, data table enrichie avec actions directes (Arrivée & OR),
// vues Pont / Mécanicien / Semaine / Liste.
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  MessageSquare,
  Phone,
  Plus,
  Search,
  Wrench,
  X,
} from "lucide-react";
import { Button, EmptyState, PlateBadge, Select } from "@atelieros/ui";
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
import { DayGrid, type GridBlock, type GridColumn } from "./day-grid";
import {
  SOURCES,
  STATUSES,
  TYPES,
  SourceIcon,
  StatusLabel,
  TypeDot,
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
import { ErrorBox, Gauge, SidePanel, Toast, type ToastState } from "./ui-bits";

type View = "bay" | "mechanic" | "week" | "list";
const VIEWS: View[] = ["list", "bay", "mechanic", "week"];
type TimeScope = "today" | "week" | "all" | "custom";
type KpiFilter = "ALL" | "CONFIRMED" | "PENDING" | "CANCELLED_OR_NO_SHOW" | "VEHICLES_EXPECTED";

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

function waUrl(phone: string | null | undefined, text?: string) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const enc = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${enc}`;
}

export default function PlanningPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const permissions = useMemo(() => new Set<string>(me.data?.permissions ?? []), [me.data]);
  const tz = me.data?.activeOrganization?.timezone ?? DEFAULT_TZ;
  const todayKey = useMemo(() => localDateKey(new Date(), tz), [tz]);

  const [dayKey, setDayKey] = useState(() => localDateKey(new Date(), DEFAULT_TZ));
  const [timeScope, setTimeScope] = useState<TimeScope>("today");
  const isMobile = useSyncExternalStore(subscribeMobile, isMobileSnapshot, () => false);
  const [viewChoice, setView] = useState<View | null>(null);
  const view: View = viewChoice ?? (isMobile ? "list" : "list");

  // Filtres
  const [search, setSearch] = useState("");
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>("ALL");
  const [typeFilter, setTypeFilter] = useState<AppointmentType | "">("");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | "">("");
  const [sourceFilter, setSourceFilter] = useState<AppointmentSource | "">("");

  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<AppointmentFormInitial | null>(null);
  const [notifyOnMove, setNotifyOnMove] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);

  const weekStart = startOfWeekKey(dayKey);
  const rangeFrom = useMemo(() => {
    if (timeScope === "all") return addDaysToKey(todayKey, -7);
    if (view === "week" || timeScope === "week") return weekStart;
    return dayKey;
  }, [timeScope, view, weekStart, dayKey, todayKey]);

  const rangeTo = useMemo(() => {
    if (timeScope === "all") return addDaysToKey(todayKey, 30);
    if (view === "week" || timeScope === "week") return addDaysToKey(weekStart, 6);
    return dayKey;
  }, [timeScope, view, weekStart, dayKey, todayKey]);

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
      void utils.appointment.invalidate();
      void utils.planning.invalidate();
    },
    onError(e) {
      showToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
      void list.refetch();
    },
  });

  const arrived = trpc.appointment.markArrived.useMutation({
    onSuccess(result) {
      showToast(ta("statuses.ARRIVED"));
      void utils.appointment.invalidate();
      void utils.planning.invalidate();
      if (result.receptionUrl) {
        router.push(result.receptionUrl);
      }
    },
    onError(e) {
      showToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
    },
  });

  const canForce = permissions.has("planning:manage");
  const canUpdate = permissions.has("appointment:update");
  const canCreate = permissions.has("appointment:create");

  const data = list.data;
  const rawAppointments = useMemo(() => data?.appointments ?? [], [data?.appointments]);
  const openingHours = (data?.site.openingHours ?? {}) as OpeningHours;
  const range = dayRange(openingHours, dayKey);
  const closed = closedRanges(openingHours, dayKey, range);

  // Calcul des KPIs sur l'ensemble des rendez-vous chargés
  const kpis = useMemo(() => {
    let todayCount = 0;
    let confirmed = 0;
    let pending = 0;
    let cancelledOrNoShow = 0;
    let vehiclesExpected = 0;

    rawAppointments.forEach((a) => {
      const isToday = localDateKey(new Date(a.startsAt), tz) === todayKey;
      if (isToday) todayCount++;
      if (a.status === "CONFIRMED") confirmed++;
      if (a.status === "BOOKED") pending++;
      if (a.status === "CANCELLED" || a.status === "NO_SHOW") cancelledOrNoShow++;
      if (
        a.vehicle &&
        a.status !== "CANCELLED" &&
        a.status !== "NO_SHOW" &&
        a.status !== "COMPLETED"
      ) {
        vehiclesExpected++;
      }
    });

    return {
      total: rawAppointments.length,
      todayCount,
      confirmed,
      pending,
      cancelledOrNoShow,
      vehiclesExpected,
    };
  }, [rawAppointments, tz, todayKey]);

  // Filtrage combiné : KPI interactif + recherche textuelle
  const filteredAppointments = useMemo(() => {
    let items = rawAppointments;

    if (kpiFilter === "CONFIRMED") {
      items = items.filter((a) => a.status === "CONFIRMED");
    } else if (kpiFilter === "PENDING") {
      items = items.filter((a) => a.status === "BOOKED");
    } else if (kpiFilter === "CANCELLED_OR_NO_SHOW") {
      items = items.filter((a) => a.status === "CANCELLED" || a.status === "NO_SHOW");
    } else if (kpiFilter === "VEHICLES_EXPECTED") {
      items = items.filter(
        (a) =>
          Boolean(a.vehicle) &&
          a.status !== "CANCELLED" &&
          a.status !== "NO_SHOW" &&
          a.status !== "COMPLETED",
      );
    }

    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((a) => {
        const customer = (a.customer.displayName ?? "").toLowerCase();
        const phone = (a.customer.phone ?? "").toLowerCase();
        const plate = (a.vehicle?.plate ?? "").toLowerCase();
        const vehicle = `${a.vehicle?.make ?? ""} ${a.vehicle?.model ?? ""}`.toLowerCase();
        const complaint = (a.complaint ?? "").toLowerCase();
        const bay = (a.bay?.name ?? "").toLowerCase();
        const mechanic = (a.mechanicName ?? "").toLowerCase();
        return (
          customer.includes(q) ||
          phone.includes(q) ||
          plate.includes(q) ||
          vehicle.includes(q) ||
          complaint.includes(q) ||
          bay.includes(q) ||
          mechanic.includes(q)
        );
      });
    }

    return items;
  }, [rawAppointments, kpiFilter, search]);

  const hasActiveFilters = Boolean(
    search.trim() ||
      kpiFilter !== "ALL" ||
      typeFilter ||
      statusFilter ||
      sourceFilter ||
      timeScope !== "today",
  );

  const resetFilters = useCallback(() => {
    setSearch("");
    setKpiFilter("ALL");
    setTypeFilter("");
    setStatusFilter("");
    setSourceFilter("");
    setTimeScope("today");
    setDayKey(todayKey);
  }, [todayKey]);

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
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      {/* En-tête de la page */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-sm">
            <Calendar size={22} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">{ta("title")}</h1>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-muted">
                {rawAppointments.length}
              </span>
            </div>
            <p className="text-xs text-muted">
              Gestion de l&apos;agenda d&apos;atelier, affectation des ponts et réceptions de véhicules
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/rendez-vous/aujourdhui"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-all hover:bg-surface-2"
          >
            <Clock size={14} className="text-muted" />
            <span>{ta("todayPage.title")}</span>
          </Link>
          {canCreate && (
            <>
              <Button
                variant="secondary"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => setCreating({ source: "PHONE" })}
              >
                <Phone size={14} aria-hidden />
                <span>{ta("phoneAppointment")}</span>
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => setCreating({})}
              >
                <Plus size={15} aria-hidden />
                <span>{ta("newAppointment")}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Cartes KPI interactives */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setTimeScope("today");
            setDayKey(todayKey);
            setKpiFilter("ALL");
          }}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            timeScope === "today" && kpiFilter === "ALL"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{ta("kpis.today")}</span>
            <Calendar size={16} className="text-muted" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {kpis.todayCount}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {fmtDay(instantOf(todayKey, "12:00", tz), tz)}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setKpiFilter(kpiFilter === "CONFIRMED" ? "ALL" : "CONFIRMED")}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            kpiFilter === "CONFIRMED"
              ? "border-status-ok bg-status-ok/5 ring-1 ring-status-ok"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{ta("kpis.confirmed")}</span>
            <CheckCircle2 size={16} className="text-status-ok" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-status-ok">
            {kpis.confirmed}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {rawAppointments.length > 0
              ? `${Math.round((kpis.confirmed / rawAppointments.length) * 100)}% du planning`
              : "—"}
          </div>
        </button>

        <button
          type="button"
          onClick={() => setKpiFilter(kpiFilter === "PENDING" ? "ALL" : "PENDING")}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            kpiFilter === "PENDING"
              ? "border-status-warn bg-status-warn/5 ring-1 ring-status-warn"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{ta("kpis.pending")}</span>
            <Clock size={16} className="text-status-warn" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-status-warn">
            {kpis.pending}
          </div>
          <div className="mt-1 text-[11px] text-muted">À confirmer avec le client</div>
        </button>

        <button
          type="button"
          onClick={() =>
            setKpiFilter(kpiFilter === "CANCELLED_OR_NO_SHOW" ? "ALL" : "CANCELLED_OR_NO_SHOW")
          }
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            kpiFilter === "CANCELLED_OR_NO_SHOW"
              ? "border-status-bad bg-status-bad/5 ring-1 ring-status-bad"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{ta("kpis.cancelledOrNoShow")}</span>
            <AlertTriangle size={16} className="text-status-bad" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-status-bad">
            {kpis.cancelledOrNoShow}
          </div>
          <div className="mt-1 text-[11px] text-muted">Annulés ou non honorés</div>
        </button>

        <button
          type="button"
          onClick={() =>
            setKpiFilter(kpiFilter === "VEHICLES_EXPECTED" ? "ALL" : "VEHICLES_EXPECTED")
          }
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all hover:bg-surface-2 ${
            kpiFilter === "VEHICLES_EXPECTED"
              ? "border-accent bg-accent/5 ring-1 ring-accent"
              : "border-border/80 bg-surface shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{ta("kpis.vehiclesExpected")}</span>
            <Car size={16} className="text-accent" />
          </div>
          <div className="mt-2 text-xl font-bold tracking-tight text-foreground">
            {kpis.vehiclesExpected}
          </div>
          <div className="mt-1 text-[11px] text-muted">Avec fiche véhicule</div>
        </button>
      </div>

      {/* Barre d'outils, filtres temporels rapides & recherche */}
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface p-3.5 shadow-sm">
        {/* Ligne 1 : Filtres temporels rapides, sélecteur de date & bascule de vue */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Filtres temporels rapides */}
            <div className="inline-flex rounded-lg border border-border bg-surface-2/40 p-1">
              <button
                type="button"
                onClick={() => {
                  setTimeScope("today");
                  setDayKey(todayKey);
                }}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  timeScope === "today"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {ta("timeScopes.today")}
              </button>
              <button
                type="button"
                onClick={() => setTimeScope("week")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  timeScope === "week"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {ta("timeScopes.thisWeek")}
              </button>
              <button
                type="button"
                onClick={() => setTimeScope("all")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  timeScope === "all"
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {ta("timeScopes.all")}
              </button>
            </div>

            {/* Sélecteur de date fin */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-surface px-1 py-0.5">
              <button
                type="button"
                aria-label={ta("previous")}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-2 text-muted hover:text-foreground"
                onClick={() => {
                  setTimeScope("custom");
                  setDayKey(addDaysToKey(dayKey, view === "week" ? -7 : -1));
                }}
              >
                <ChevronLeft size={16} />
              </button>
              <input
                type="date"
                aria-label={ta("form.date")}
                value={dayKey}
                onChange={(e) => {
                  if (e.target.value) {
                    setTimeScope("custom");
                    setDayKey(e.target.value);
                  }
                }}
                className="h-7 border-0 bg-transparent px-2 text-xs font-medium focus:ring-0"
              />
              <button
                type="button"
                aria-label={ta("next")}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-2 text-muted hover:text-foreground"
                onClick={() => {
                  setTimeScope("custom");
                  setDayKey(addDaysToKey(dayKey, view === "week" ? 7 : 1));
                }}
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <span className="text-xs text-muted font-medium" data-testid="planning-date">
              {timeScope === "all"
                ? "Plage élargie (-7j à +30j)"
                : view === "week" || timeScope === "week"
                  ? `${fmtDay(instantOf(weekStart, "12:00", tz), tz)} → ${fmtDay(instantOf(rangeTo, "12:00", tz), tz)}`
                  : fmtDay(instantOf(dayKey, "12:00", tz), tz)}
            </span>
          </div>

          {/* Vues du planning */}
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2/40 p-1" role="tablist">
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  view === v
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {ta(`views.${v}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Ligne 2 : Recherche instantanée & Filtres déroulants */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
          <div className="relative sm:col-span-5">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ta("searchPlaceholder")}
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-xs placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Effacer la recherche"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="sm:col-span-2">
            <Select
              aria-label={ta("filters.allTypes")}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AppointmentType | "")}
              className="h-9 text-xs"
            >
              <option value="">{ta("filters.allTypes")}</option>
              {TYPES.map((v) => (
                <option key={v} value={v}>
                  {ta(`types.${v}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Select
              aria-label={ta("filters.allStatuses")}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | "")}
              className="h-9 text-xs"
            >
              <option value="">{ta("filters.allStatuses")}</option>
              {STATUSES.map((v) => (
                <option key={v} value={v}>
                  {ta(`statuses.${v}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Select
              aria-label={ta("filters.allSources")}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as AppointmentSource | "")}
              className="h-9 text-xs"
            >
              <option value="">{ta("filters.allSources")}</option>
              {SOURCES.map((v) => (
                <option key={v} value={v}>
                  {ta(`sources.${v}`)}
                </option>
              ))}
            </Select>
          </div>

          {hasActiveFilters && (
            <div className="sm:col-span-1 flex items-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="h-9 w-full text-xs text-muted hover:text-foreground"
              >
                {ta("filterReset")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bandeau de capacité si pertinent */}
      {(view === "bay" || view === "mechanic") && dayCapacity.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="capacity-banner">
          {dayCapacity.map((row) => (
            <CapacityGauge key={row.halfDay} row={row} />
          ))}
        </div>
      )}

      {/* États de chargement et erreurs */}
      {list.isLoading && (
        <div className="flex flex-col gap-2" aria-busy>
          <div className="skeleton h-14 rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-96 rounded-lg" />
            ))}
          </div>
        </div>
      )}
      {list.isError && <ErrorBox message={ta("loadError")} onRetry={() => list.refetch()} />}

      {/* VUE LISTE / TABLEAU ENRICHIE */}
      {data && view === "list" && (
        <ListView
          items={filteredAppointments}
          tz={tz}
          onSelect={setSelected}
          onArrived={(id) => arrived.mutate({ id })}
          isArriving={arrived.isPending}
          hasActiveFilters={hasActiveFilters}
          onResetFilters={resetFilters}
          canUpdate={canUpdate}
          canCreate={canCreate}
          onNewAppointment={() => setCreating({})}
        />
      )}

      {/* VUES CALENDRIER (Pont / Mécanicien) */}
      {data && (view === "bay" || view === "mechanic") && (
        <>
          {canUpdate && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <label className="flex items-center gap-2">
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
          {data.appointments.length === 0 && <EmptyState title={ta("empty")} />}
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
              onMove={(id, key, minutes, alt) =>
                moveAppointment(id, key, minutes, alt, "mechanic")
              }
              onResize={(id, durationMinutes) =>
                update.mutate({ id, durationMinutes, notifyCustomer: false, force: false })
              }
            />
          )}
        </>
      )}

      {/* VUE SEMAINE */}
      {data && view === "week" && (
        <WeekView
          data={data}
          capacity={capacity.data ?? []}
          weekStart={weekStart}
          tz={tz}
          onOpenDay={(key) => {
            setDayKey(key);
            setView("list");
          }}
          onSelect={setSelected}
        />
      )}

      {/* PANNEAUX LATÉRAUX & FORMULAIRES */}
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
    <div className="rounded-lg border border-border bg-surface p-3">
      <Gauge
        ratio={ratio}
        tone={tone}
        label={`${label} · ${ta("appointmentsCount", { count: row.appointmentsCount })}`}
      />
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
    return {
      key: m.id,
      label: m.name,
      disabled: available === 0,
      header: (
        <Gauge
          ratio={ratio}
          tone={ratio > 0.9 ? "bad" : ratio >= 0.7 ? "warn" : "ok"}
          label={
            available === 0
              ? ta("mechanicAbsent")
              : ta("mechanicLoad", {
                  planned: formatMinutesFr(planned),
                  available: formatMinutesFr(available),
                })
          }
        />
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
  if (data.appointments.length === 0) return <EmptyState title={ta("emptyWeek")} />;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="week-view">
      {Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStart, i)).map((key) => {
        const rows = capacity.filter((r) => r.date === key);
        const load = rows.reduce((s, r) => s + r.loadMinutes, 0);
        const openMinutes = rows.reduce((s, r) => s + r.openMinutes, 0) * bays;
        const ratio = openMinutes ? load / openMinutes : 0;
        const items = data.appointments.filter(
          (a) => localDateKey(new Date(a.startsAt), tz) === key && a.status !== "CANCELLED",
        );
        return (
          <div key={key} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <button
              type="button"
              onClick={() => onOpenDay(key)}
              className="min-h-11 text-left font-semibold hover:underline"
            >
              {fmtDay(instantOf(key, "12:00", tz), tz)}
            </button>
            <span className="text-sm">{ta("appointmentsCount", { count: items.length })}</span>
            <Gauge
              ratio={ratio}
              tone={ratio > 0.9 ? "bad" : ratio >= 0.7 ? "warn" : "ok"}
              label={ta("occupancy", { percent: Math.round(ratio * 100) })}
            />
            <ul className="flex flex-col gap-1 text-xs">
              {items.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className="flex min-h-8 w-full items-center gap-1 text-left hover:underline"
                  >
                    <span className="font-medium">{fmtTime(a.startsAt, tz)}</span>
                    <span className="truncate">{a.customer.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Vue Tableau & Liste enrichie des RDV avec alertes, raccourcis et conversion directe en OR */
function ListView({
  items,
  tz,
  onSelect,
  onArrived,
  isArriving,
  hasActiveFilters,
  onResetFilters,
  canUpdate,
  canCreate,
  onNewAppointment,
}: {
  items: PlanningAppointment[];
  tz: string;
  onSelect: (id: string) => void;
  onArrived: (id: string) => void;
  isArriving: boolean;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  canUpdate: boolean;
  canCreate: boolean;
  onNewAppointment: () => void;
}) {
  if (items.length === 0) {
    if (hasActiveFilters) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-12 text-center bg-surface">
          <CalendarDays size={40} className="text-muted" />
          <div>
            <h3 className="text-base font-semibold text-foreground">{ta("emptySearch")}</h3>
            <p className="mt-1 text-xs text-muted max-w-sm">{ta("emptySearchDescription")}</p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={onResetFilters}>
              {ta("filterReset")}
            </Button>
            {canCreate && (
              <Button size="sm" onClick={onNewAppointment}>
                <Plus size={14} className="mr-1" />
                {ta("newAppointment")}
              </Button>
            )}
          </div>
        </div>
      );
    }
    return (
      <EmptyState
        title={ta("empty")}
        action={
          canCreate ? (
            <Button onClick={onNewAppointment}>
              <Plus size={14} className="mr-1" />
              {ta("newAppointment")}
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="list-view">
      {/* Version Desktop : Data table structurée */}
      <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 font-semibold text-muted">
              <th className="py-3 pl-4 pr-3">{ta("table.slot")}</th>
              <th className="px-3 py-3">{ta("table.customer")}</th>
              <th className="px-3 py-3">{ta("table.vehicle")}</th>
              <th className="px-3 py-3">{ta("table.reason")}</th>
              <th className="px-3 py-3">{ta("table.resource")}</th>
              <th className="px-3 py-3">{ta("table.status")}</th>
              <th className="py-3 pl-3 pr-4 text-right">{ta("table.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {items.map((a) => {
              const phoneLink = a.customer.phone ? `tel:${a.customer.phone}` : null;
              const wa = waUrl(
                a.customer.whatsappPhone ?? a.customer.phone,
                `Bonjour ${a.customer.displayName}, nous vous rappelons votre rendez-vous chez notre garage prévu le ${fmtDay(a.startsAt, tz)} à ${fmtTime(a.startsAt, tz)}.`,
              );
              const canArrive =
                canUpdate &&
                (a.status === "BOOKED" || a.status === "CONFIRMED") &&
                !a.repairOrderId;

              return (
                <tr
                  key={a.id}
                  className={`group transition-colors hover:bg-surface-2/50 ${
                    a.flags.late ? "bg-status-bad/5" : ""
                  }`}
                >
                  {/* Créneau horaire */}
                  <td className="py-3 pl-4 pr-3 align-middle">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        <Clock size={13} className="text-muted" />
                        <span>
                          {fmtTime(a.startsAt, tz)} – {fmtTime(a.endsAt, tz)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                        <span>{formatMinutesFr(a.durationMinutes)}</span>
                        <span>·</span>
                        <span>{fmtDay(a.startsAt, tz)}</span>
                      </div>
                      {a.flags.late && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded bg-status-bad/10 px-1.5 py-0.5 text-[10px] font-medium text-status-bad">
                          <AlertTriangle size={10} />
                          {ta("badges.late")}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Client & Contact */}
                  <td className="px-3 py-3 align-middle">
                    <div className="flex flex-col gap-1 max-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        <SourceIcon source={a.source as AppointmentSource} />
                        <button
                          type="button"
                          onClick={() => onSelect(a.id)}
                          className="font-semibold text-foreground hover:underline truncate text-left"
                        >
                          {a.customer.displayName}
                        </button>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted">
                        {phoneLink && (
                          <a
                            href={phoneLink}
                            className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                            title="Appeler"
                          >
                            <Phone size={11} />
                            <span>{a.customer.phone}</span>
                          </a>
                        )}
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-status-ok bg-status-ok/10 hover:bg-status-ok/20"
                            title="Contacter sur WhatsApp"
                          >
                            <MessageSquare size={10} />
                            <span>WA</span>
                          </a>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Véhicule & Plaque */}
                  <td className="px-3 py-3 align-middle">
                    {a.vehicle ? (
                      <div className="flex flex-col gap-1 max-w-[180px]">
                        <div className="flex items-center gap-1.5">
                          <PlateBadge plate={a.vehicle.plate} className="text-xs" />
                        </div>
                        <span className="truncate text-[11px] text-muted">
                          {a.vehicle.make} {a.vehicle.model}
                        </span>
                        {a.flags.inspectionSoon && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-status-warn">
                            <AlertTriangle size={10} />
                            {ta("table.inspectionSoon")}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">
                        {ta("table.noVehicle")}
                      </span>
                    )}
                  </td>

                  {/* Prestation & Motif */}
                  <td className="px-3 py-3 align-middle">
                    <div className="flex flex-col gap-1 max-w-[220px]">
                      <TypeDot type={a.type as AppointmentType} />
                      {a.complaint ? (
                        <span className="text-[11px] text-muted line-clamp-2" title={a.complaint}>
                          {a.complaint}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted italic">Sans doléance</span>
                      )}
                      {a.overbooked && (
                        <span className="inline-flex items-center text-[10px] text-status-bad font-medium">
                          {ta("badges.overbooked")}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Ressource (Pont / Mécanicien) */}
                  <td className="px-3 py-3 align-middle">
                    <div className="flex flex-col text-[11px]">
                      <span className="font-medium text-foreground">
                        {a.bay?.name ?? ta("unassigned")}
                      </span>
                      {a.mechanicName && (
                        <span className="text-muted truncate">{a.mechanicName}</span>
                      )}
                    </div>
                  </td>

                  {/* Statut */}
                  <td className="px-3 py-3 align-middle">
                    <StatusLabel status={a.status as AppointmentStatus} />
                  </td>

                  {/* Actions directes */}
                  <td className="py-3 pl-3 pr-4 align-middle text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {canArrive && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={isArriving}
                          onClick={() => onArrived(a.id)}
                          className="h-8 gap-1 text-[11px] font-medium border-accent/40 bg-accent/5 hover:bg-accent/15 text-accent"
                          title="Marquer le client arrivé et basculer vers la réception / création d'OR"
                        >
                          <Wrench size={13} />
                          <span>{ta("table.markArrived")}</span>
                        </Button>
                      )}

                      {a.repairOrderId && (
                        <Link
                          href={`/ordres/${a.repairOrderId}`}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11px] font-medium text-foreground transition-all hover:bg-surface-2"
                        >
                          <ExternalLink size={12} className="text-muted" />
                          <span>{ta("table.openOrder")}</span>
                        </Link>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onSelect(a.id)}
                        className="h-8 text-[11px] text-muted hover:text-foreground"
                      >
                        {ta("table.details")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Version Mobile : Cartes interactives enrichies */}
      <div className="md:hidden flex flex-col gap-2.5">
        {items.map((a) => (
          <div
            key={a.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col">
                <span className="font-semibold text-foreground text-sm">
                  {fmtTime(a.startsAt, tz)} – {fmtTime(a.endsAt, tz)}
                </span>
                <span className="text-[11px] text-muted">
                  {fmtDay(a.startsAt, tz)} ({formatMinutesFr(a.durationMinutes)})
                </span>
              </div>
              <StatusLabel status={a.status as AppointmentStatus} />
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                className="font-medium text-foreground text-left truncate hover:underline"
              >
                {a.customer.displayName}
              </button>
              {a.vehicle && <PlateBadge plate={a.vehicle.plate} className="text-[11px]" />}
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted">
              <TypeDot type={a.type as AppointmentType} />
              <span>{a.bay?.name ?? ta("unassigned")}</span>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
              {canUpdate && (a.status === "BOOKED" || a.status === "CONFIRMED") && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={isArriving}
                  onClick={() => onArrived(a.id)}
                  className="h-8 text-xs text-accent"
                >
                  <Wrench size={12} className="mr-1" />
                  {ta("table.markArrived")}
                </Button>
              )}
              {a.repairOrderId && (
                <Link
                  href={`/ordres/${a.repairOrderId}`}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface px-2.5 text-xs text-foreground"
                >
                  {ta("table.openOrder")}
                </Link>
              )}
              <Button size="sm" variant="ghost" onClick={() => onSelect(a.id)} className="h-8 text-xs">
                {ta("table.details")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
