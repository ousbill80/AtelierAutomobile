"use client";

// M10 — échéances. La visite technique se prépare 1 à 2 mois avant (atelier) et le client
// est relancé automatiquement dans les 30 jours (WhatsApp, SMS).
import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CircleAlert,
  List,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Send,
  ShieldAlert,
} from "lucide-react";
import { EduTip } from "@/components/edu-tip";
import { localDateKey } from "@atelieros/core/planning";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, EmptyState, PlateBadge } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { Kpi } from "@/components/cash/cash-ui";
import { computeDueStatus, formatDate } from "../reminder-labels";
import { DueCalendar } from "./due-calendar";
import { DueRemindDialog } from "./remind-dialog";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type VehicleDue = RouterOutputs["reminders"]["dueDates"]["items"][number];
type Kind = "INSPECTION" | "SERVICE" | "INSURANCE";
type Filter = "ALL" | "WORKSHOP" | "CLIENT" | "EXPIRED" | "MISSING_DATA";

const KINDS: Kind[] = ["INSPECTION", "SERVICE", "INSURANCE"];
const FILTERS: Filter[] = ["ALL", "WORKSHOP", "CLIENT", "EXPIRED", "MISSING_DATA"];
const DEFAULT_TZ = "Africa/Abidjan";
type View = "list" | "calendar";
const ROW_GRID = "lg:grid-cols-[2rem_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1fr)_7.5rem_auto]";

function nextWeekday(weekday: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  const delta = (weekday + 7 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + delta);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function weekdayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

export default function EcheancesPage() {
  const [kind, setKind] = useState<Kind>("INSPECTION");
  const [chosenFilter, setChosenFilter] = useState<Filter>("ALL");
  const [filterTouched, setFilterTouched] = useState(false);
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const timeZone = me.data?.activeOrganization?.timezone ?? DEFAULT_TZ;
  const [now] = useState(() => new Date());
  const todayKey = localDateKey(now, timeZone);
  const [view, setView] = useState<View>("list");
  const [month, setMonth] = useState(() => localDateKey(now, DEFAULT_TZ).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const overview = trpc.reminders.dueOverview.useQuery();
  // Sans date connue mais avec des fiches incomplètes : ouvrir directement « données manquantes ».
  const autoMissing =
    !filterTouched &&
    kind === "INSPECTION" &&
    !!overview.data &&
    overview.data.workshop + overview.data.client + overview.data.expired === 0 &&
    overview.data.missing > 0;
  const filter: Filter = autoMissing ? "MISSING_DATA" : chosenFilter;
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.reminders.dueDates.useInfiniteQuery(
      view === "calendar" && selectedDay
        ? { kind, filter: "ALL", day: selectedDay, limit: 50 }
        : { kind, filter, limit: 50 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        enabled: view === "list" || selectedDay !== null,
      },
    );
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [remindIds, setRemindIds] = useState<string[] | null>(null);
  // Véhicules (de la liste) par client : « 2 véhicules » à côté du nom.
  const vehiclesPerCustomer = new Map<string, number>();
  for (const v of items) {
    vehiclesPerCustomer.set(v.customerId, (vehiclesPerCustomer.get(v.customerId) ?? 0) + 1);
  }
  const remindable = items.filter((v) => !!dueDateOf(v, kind)).map((v) => v.id);
  const allSelected = remindable.length > 0 && remindable.every((id) => selection.has(id));

  function toggleSelected(id: string) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function chooseFilter(next: Filter) {
    setSelection(new Set());
    setFilterTouched(true);
    setChosenFilter(next);
  }

  function refresh() {
    void utils.reminders.dueDates.invalidate();
    void utils.reminders.dueOverview.invalidate();
    void utils.reminders.dueCalendar.invalidate();
  }

  function chooseView(next: View) {
    setView(next);
    setSelectedDay(null);
  }

  const showList = view === "list" || selectedDay !== null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {t("reminders.due.title")}
            <EduTip text={t("reminders.due.rhythm")} example={t("reminders.due.rhythmExample")} />
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">{t("reminders.due.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/relances" className="btn btn-secondary min-h-11">
            {t("reminders.due.openQueue")}
          </Link>
          <Link href="/creances" className="btn btn-secondary min-h-11">
            {t("reminders.due.openReceivables")}
          </Link>
        </div>
      </header>

      {overview.data && kind === "INSPECTION" && (
        <section
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          aria-label={t("reminders.due.title")}
        >
          <Kpi
            icon={CalendarClock}
            label={t("reminders.due.kpiWorkshop")}
            value={String(overview.data.workshop)}
            tone="ok"
            hint={t("reminders.due.kpiWorkshopHint")}
            help={t("reminders.due.help.workshop")}
            example={t("reminders.due.example.workshop")}
            onClick={() => chooseFilter("WORKSHOP")}
          />
          <Kpi
            icon={Phone}
            label={t("reminders.due.kpiClient")}
            value={String(overview.data.client)}
            tone="warn"
            hint={t("reminders.due.kpiClientHint")}
            help={t("reminders.due.help.client")}
            example={t("reminders.due.example.client")}
            onClick={() => chooseFilter("CLIENT")}
          />
          <Kpi
            icon={CircleAlert}
            label={t("reminders.due.kpiExpired")}
            value={String(overview.data.expired)}
            tone={overview.data.expired > 0 ? "bad" : "neutral"}
            help={t("reminders.due.help.expired")}
            example={t("reminders.due.example.expired")}
            onClick={() => chooseFilter("EXPIRED")}
          />
          <Kpi
            icon={ShieldAlert}
            label={t("reminders.due.kpiMissing")}
            value={String(overview.data.missing)}
            tone={overview.data.missing > 0 ? "warn" : "neutral"}
            help={t("reminders.due.help.missing")}
            example={t("reminders.due.example.missing")}
            onClick={() => chooseFilter("MISSING_DATA")}
          />
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t("reminders.due.kindLabel")}
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
          {KINDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setFilterTouched(true);
                setChosenFilter("ALL");
                setSelectedDay(null);
                setSelection(new Set());
              }}
              className={`min-h-11 rounded px-3 text-sm ${kind === value ? "bg-accent text-accent-foreground" : "text-muted"}`}
            >
              {t(`reminders.due.tabs.${value}`)}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label={t("reminders.due.calendar.viewLabel")}
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
          {(["list", "calendar"] as const).map((value) => {
            const Icon = value === "list" ? List : CalendarDays;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => chooseView(value)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded px-3 text-sm ${
                  view === value ? "bg-accent text-accent-foreground" : "text-muted"
                }`}
              >
                <Icon size={16} aria-hidden />
                {t(
                  value === "list"
                    ? "reminders.due.calendar.viewList"
                    : "reminders.due.calendar.viewCalendar",
                )}
              </button>
            );
          })}
        </div>
        {view === "list" && (
          <select
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm sm:ml-auto sm:w-auto"
            aria-label={t("reminders.due.title")}
            value={filter}
            onChange={(e) => chooseFilter(e.target.value as Filter)}
          >
            {FILTERS.map((value) => (
              <option key={value} value={value}>
                {t(`reminders.due.filters.${value}`)}
              </option>
            ))}
          </select>
        )}
        {showList && remindable.length > 0 && (
          <Button className="min-h-11 w-full sm:w-auto" onClick={() => setRemindIds(remindable)}>
            <Send size={16} aria-hidden />
            {t("reminders.due.remind.all", { count: remindable.length })}
          </Button>
        )}
      </div>

      {view === "calendar" && (
        <DueCalendar
          kind={kind}
          month={month}
          today={todayKey}
          selectedDay={selectedDay}
          onMonthChange={(next) => {
            setMonth(next);
            setSelectedDay(null);
          }}
          onSelectDay={setSelectedDay}
        />
      )}

      {showList && isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-border bg-surface-2"
            />
          ))}
        </div>
      )}

      {showList && isError && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-status-bad bg-status-bad-bg p-4">
          <p className="text-sm text-status-bad">{t("reminders.due.error")}</p>
          <Button variant="secondary" onClick={() => refetch()}>
            {t("reminders.due.retry")}
          </Button>
        </div>
      )}

      {showList && !isLoading && !isError && items.length === 0 && (
        <EmptyState
          title={selectedDay ? t("reminders.due.calendar.emptyDay") : t("reminders.due.empty")}
        />
      )}

      {showList && !isLoading && !isError && items.length > 0 && (
        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-surface">
          <div
            className={`hidden gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase lg:grid ${ROW_GRID}`}
          >
            <span className="flex items-center">
              <input
                type="checkbox"
                className="size-4"
                aria-label={t("reminders.due.remind.selectAll")}
                checked={allSelected}
                disabled={remindable.length === 0}
                onChange={() => setSelection(allSelected ? new Set() : new Set(remindable))}
              />
            </span>
            <span>{t("reminders.due.colVehicle")}</span>
            <span>{t("reminders.due.colCustomer")}</span>
            <span>{t("reminders.due.colDue")}</span>
            <span>{t("reminders.due.colDays")}</span>
            <span className="text-right">{t("reminders.due.colActions")}</span>
          </div>
          <ul className="divide-y divide-border">
            {items.map((vehicle) => (
              <VehicleDueRow
                key={vehicle.id}
                vehicle={vehicle}
                kind={kind}
                onChanged={refresh}
                selected={selection.has(vehicle.id)}
                onToggle={() => toggleSelected(vehicle.id)}
                customerVehicles={vehiclesPerCustomer.get(vehicle.customerId) ?? 1}
                onRemind={() => setRemindIds([vehicle.id])}
              />
            ))}
          </ul>
        </div>
      )}

      {showList && hasNextPage && (
        <Button variant="secondary" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {t("reminders.due.loadMore")}
        </Button>
      )}

      {selection.size > 0 && (
        <div className="sticky bottom-[calc(var(--bottom-nav-offset,0px)+0.75rem)] z-30 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
          <span className="text-sm font-medium">
            {t("reminders.due.remind.selected", { count: selection.size })}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={() => setSelection(new Set())}>
              {t("reminders.due.remind.clear")}
            </Button>
            <Button onClick={() => setRemindIds([...selection])}>
              <Send size={16} aria-hidden />
              {t("reminders.due.remind.selection", { count: selection.size })}
            </Button>
          </span>
        </div>
      )}

      {remindIds && (
        <DueRemindDialog
          kind={kind}
          vehicleIds={remindIds}
          onClose={() => setRemindIds(null)}
          onDone={() => {
            setSelection(new Set());
            refresh();
          }}
        />
      )}
    </div>
  );
}

function dueDateOf(vehicle: VehicleDue, kind: Kind) {
  return kind === "INSPECTION"
    ? vehicle.inspectionExpiryDate
    : kind === "SERVICE"
      ? vehicle.nextServiceDueDate
      : vehicle.insuranceExpiryDate;
}

function VehicleDueRow({
  vehicle,
  kind,
  onChanged,
  selected,
  onToggle,
  customerVehicles,
  onRemind,
}: {
  vehicle: VehicleDue;
  kind: Kind;
  onChanged: () => void;
  selected: boolean;
  onToggle: () => void;
  customerVehicles: number;
  onRemind: () => void;
}) {
  const [booking, setBooking] = useState(false);
  const [noting, setNoting] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [doingInspection, setDoingInspection] = useState(false);
  const [savingDate, setSavingDate] = useState(false);
  const [booked, setBooked] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [center, setCenter] = useState("");
  const monday = nextWeekday(1);
  const tuesday = nextWeekday(2);

  const markAppointmentTaken = trpc.reminders.markAppointmentTaken.useMutation({
    onSuccess: () => {
      setNoting(false);
      onChanged();
    },
  });
  const book = trpc.appointment.create.useMutation({
    onSuccess: () => {
      setBooking(false);
      setBooked(true);
      onChanged();
    },
  });
  const markInspectionDone = trpc.reminders.markInspectionDone.useMutation({
    onSuccess: () => {
      setDoingInspection(false);
      setSavingDate(false);
      onChanged();
    },
  });

  const relevantDate = dueDateOf(vehicle, kind);
  const due = computeDueStatus(relevantDate);
  const phone = vehicle.customer.phone;
  const whatsapp = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null;
  const dueLabel =
    kind === "SERVICE"
      ? t("reminders.due.dueOn", { date: formatDate(relevantDate) })
      : t("reminders.due.expiresOn", { date: formatDate(relevantDate) });
  const daysLabel =
    due.daysRemaining == null
      ? "—"
      : due.daysRemaining < 0
        ? t("reminders.due.daysOver", { count: Math.abs(due.daysRemaining) })
        : t("reminders.due.daysLeft", { count: due.daysRemaining });

  function bookOn(day: string) {
    book.mutate({
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      type: "INSPECTION_PREP",
      startsAt: new Date(`${day}T08:00:00`),
      source: "REMINDER",
      complaint: t("reminders.due.prepComplaint"),
      notifyCustomer: true,
      laborOperationIds: [],
    });
  }

  const [moreOpen, setMoreOpen] = useState(false);
  const vehicleLabel = `${vehicle.make} ${vehicle.model}`;
  const whatsappText = t(
    kind === "SERVICE"
      ? "reminders.due.waText.SERVICE"
      : kind === "INSURANCE"
        ? "reminders.due.waText.INSURANCE"
        : "reminders.due.waText.INSPECTION",
    {
      name: vehicle.customer.displayName,
      vehicle: `${vehicleLabel} (${vehicle.plate})`,
      date: formatDate(relevantDate),
    },
  );
  const tone =
    due.status === "EXPIRED"
      ? "bad"
      : due.status === "DUE_SOON"
        ? "warn"
        : due.status === "OK"
          ? "ok"
          : "off";
  const PILL: Record<string, string> = {
    bad: "bg-status-bad-bg text-status-bad",
    warn: "bg-status-warn-bg text-status-warn",
    ok: "bg-status-ok-bg text-status-ok",
    off: "bg-surface-2 text-muted",
  };

  return (
    <li>
      <div className="flex min-w-0 flex-col gap-2 px-3 py-2.5 text-sm lg:px-4">
        <div
          className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 lg:gap-3 ${ROW_GRID}`}
        >
          <span className="row-span-4 flex items-center self-start pt-1.5 lg:row-span-1 lg:self-center lg:pt-0">
            <input
              type="checkbox"
              className="size-5 lg:size-4"
              aria-label={t("reminders.due.remind.selectRow", { plate: vehicle.plate })}
              checked={selected}
              disabled={!relevantDate}
              onChange={onToggle}
            />
          </span>
          <span className="flex min-w-0 items-center gap-2.5">
            <PlateBadge plate={vehicle.plate} plateType={vehicle.plateType} />
            <span className="min-w-0 truncate font-medium">{vehicleLabel}</span>
          </span>
          {/* Mobile : délai à droite du véhicule. */}
          <span
            className={`justify-self-end rounded-full px-2 py-0.5 text-xs font-semibold lg:hidden ${PILL[tone]}`}
          >
            {daysLabel}
          </span>
          <span className="col-span-2 min-w-0 lg:col-span-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link
                href={`/clients/${vehicle.customerId}`}
                className="truncate font-medium hover:underline"
              >
                {vehicle.customer.displayName}
              </Link>
              {customerVehicles > 1 && (
                <span
                  className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted"
                  title={t("reminders.due.remind.multiHint")}
                >
                  {t("reminders.due.remind.multi", { count: customerVehicles })}
                </span>
              )}
            </span>
            {phone && <span className="block text-xs text-muted">{phone}</span>}
          </span>
          <span className="col-span-2 min-w-0 text-xs text-muted lg:col-span-1 lg:text-sm lg:text-foreground">
            <span className="block">{relevantDate ? dueLabel : t("reminders.due.noDate")}</span>
            {kind === "SERVICE" && vehicle.nextServiceDueMileage ? (
              <span className="block text-xs text-muted">
                {t("reminders.due.mileage", {
                  km: vehicle.nextServiceDueMileage.toLocaleString("fr-FR"),
                })}
              </span>
            ) : null}
          </span>
          <span className="hidden lg:block">
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[tone]}`}
            >
              {daysLabel}
            </span>
          </span>
          <span className="col-span-2 flex items-center justify-end gap-0.5 lg:col-span-1">
            {phone && (
              <a
                href={`tel:${phone}`}
                aria-label={t("reminders.due.call")}
                title={t("reminders.due.call")}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
              >
                <Phone size={17} aria-hidden />
              </a>
            )}
            {relevantDate && (
              <Button size="sm" className="min-h-11" onClick={onRemind}>
                <Send size={15} aria-hidden /> {t("reminders.due.remind.row")}
              </Button>
            )}
            {relevantDate ? (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                aria-label={t("reminders.due.bookShort")}
                title={t("reminders.due.bookShort")}
                onClick={() => setBooking((v) => !v)}
              >
                <CalendarPlus size={15} aria-hidden />
                <span className="hidden xl:inline">{t("reminders.due.bookShort")}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                className="min-h-11"
                onClick={() => setSavingDate((v) => !v)}
              >
                {t("reminders.due.saveDate")}
              </Button>
            )}
            <span className="relative">
              <button
                type="button"
                aria-label={t("reminders.due.more")}
                title={t("reminders.due.more")}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-surface-2"
              >
                <MoreHorizontal size={18} aria-hidden />
              </button>
              {moreOpen && (
                <span
                  aria-hidden
                  className="fixed inset-0 z-10"
                  onClick={() => setMoreOpen(false)}
                />
              )}
              {moreOpen && (
                <span
                  role="menu"
                  className="absolute right-0 z-20 mt-1 flex min-w-56 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg"
                >
                  <button
                    role="menuitem"
                    type="button"
                    className="min-h-11 rounded-md px-3 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      setNoting(true);
                      setMoreOpen(false);
                    }}
                  >
                    {t("reminders.due.alreadyBooked")}
                  </button>
                  {kind === "INSPECTION" && relevantDate && (
                    <button
                      role="menuitem"
                      type="button"
                      className="min-h-11 rounded-md px-3 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setDoingInspection(true);
                        setMoreOpen(false);
                      }}
                    >
                      {t("reminders.due.markDone")}
                    </button>
                  )}
                  {whatsapp && (
                    <a
                      role="menuitem"
                      href={`${whatsapp}?text=${encodeURIComponent(whatsappText)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm hover:bg-surface-2"
                      onClick={() => setMoreOpen(false)}
                    >
                      <MessageCircle size={15} aria-hidden />
                      {t("reminders.due.remind.whatsappPhone")}
                    </a>
                  )}
                  <Link
                    role="menuitem"
                    href={`/vehicules/${vehicle.id}`}
                    className="flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-surface-2"
                  >
                    {t("reminders.due.openVehicle")}
                  </Link>
                </span>
              )}
            </span>
          </span>
        </div>

        {booking && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2.5">
            <span className="text-sm">{t("reminders.due.bookPrompt")}</span>
            <Button size="sm" disabled={book.isPending} onClick={() => bookOn(monday)}>
              {t("reminders.due.bookMonday", { date: weekdayLabel(monday) })}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={book.isPending}
              onClick={() => bookOn(tuesday)}
            >
              {t("reminders.due.bookTuesday", { date: weekdayLabel(tuesday) })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBooking(false)}>
              {t("reminders.due.cancel")}
            </Button>
            {book.error && <p className="text-xs text-status-bad">{book.error.message}</p>}
          </div>
        )}
        {booked && <p className="text-xs text-status-ok">{t("reminders.due.booked")}</p>}

        {noting && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              markAppointmentTaken.mutate({
                vehicleId: vehicle.id,
                date: appointmentDate ? new Date(`${appointmentDate}T12:00:00`) : undefined,
                createAppointment: false,
              });
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {t("reminders.due.appointmentDate")}
              <input
                type="date"
                className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={markAppointmentTaken.isPending}>
              {t("reminders.due.confirm")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setNoting(false)}>
              {t("reminders.due.cancel")}
            </Button>
            {markAppointmentTaken.error && (
              <p className="text-xs text-status-bad">{markAppointmentTaken.error.message}</p>
            )}
          </form>
        )}

        {(doingInspection || savingDate) && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!expiryDate) return;
              markInspectionDone.mutate({
                vehicleId: vehicle.id,
                expiryDate: new Date(`${expiryDate}T00:00:00Z`),
                lastDate: lastDate ? new Date(`${lastDate}T00:00:00Z`) : undefined,
                center: center.trim() || undefined,
              });
            }}
          >
            <label className="flex flex-col gap-1 text-sm">
              {savingDate ? t("reminders.due.expiry") : t("reminders.due.newExpiry")}
              <input
                type="date"
                required
                className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </label>
            {doingInspection && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  {t("reminders.due.doneOn")} ({t("reminders.due.optional")})
                  <input
                    type="date"
                    className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
                    value={lastDate}
                    onChange={(e) => setLastDate(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {t("reminders.due.center")} ({t("reminders.due.optional")})
                  <input
                    type="text"
                    className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm"
                    value={center}
                    onChange={(e) => setCenter(e.target.value)}
                  />
                </label>
              </>
            )}
            <Button type="submit" disabled={markInspectionDone.isPending}>
              {t("reminders.due.confirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDoingInspection(false);
                setSavingDate(false);
              }}
            >
              {t("reminders.due.cancel")}
            </Button>
            {markInspectionDone.error && (
              <p className="text-xs text-status-bad">{markInspectionDone.error.message}</p>
            )}
          </form>
        )}
      </div>
    </li>
  );
}
