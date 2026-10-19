"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, Modal, PageHead, Select } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import "./planning.css";
import { AppointmentForm } from "./_components/AppointmentForm";
import { AppointmentPanel } from "./_components/AppointmentPanel";
import { FindSlotDialog } from "./_components/FindSlotDialog";
import { ListView } from "./_components/ListView";
import { bayColumns, formatHours, mechanicColumns, PlanningGrid } from "./_components/PlanningGrid";
import { WeekView } from "./_components/WeekView";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  sourceLabel,
  statusLabel,
  typeLabel,
} from "./_lib/labels";
import {
  addDays,
  civilDay,
  formatLongDay,
  instantAt,
  openingRanges,
  startOfWeek,
} from "./_lib/time";
import { useActiveSite } from "./_lib/useActiveSite";
import { domainCodeOf, ToastProvider, useToast } from "./_lib/useToast";

type View = "bay" | "mechanic" | "week" | "list";

export default function PlanningPage() {
  return (
    <ToastProvider>
      <PlanningScreen />
    </ToastProvider>
  );
}

function PlanningScreen() {
  const site = useActiveSite();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [view, setView] = useState<View>(() =>
    typeof window !== "undefined" && window.innerWidth < 760 ? "list" : "bay",
  );
  const [day, setDay] = useState(() => civilDay(new Date(), "Africa/Abidjan"));
  // `undefined` = jamais touché → RDV de l'URL (?appointment=) ; `null` = panneau fermé.
  const [selectedState, setSelected] = useState<string | null | undefined>(undefined);
  const selected = selectedState === undefined ? params.get("appointment") : selectedState;
  const [createAt, setCreateAt] = useState<{
    startsAt: Date;
    bayId: string | null;
    source?: string;
  } | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const tz = "Africa/Abidjan";
  const weekStart = startOfWeek(day);
  const from = view === "week" ? instantAt(weekStart, "00:00", tz) : instantAt(day, "00:00", tz);
  const to =
    view === "week"
      ? instantAt(addDays(weekStart, 7), "00:00", tz)
      : instantAt(addDays(day, 1), "00:00", tz);

  const list = trpc.appointment.list.useQuery(
    {
      siteId: site.siteId ?? "",
      from,
      to,
      types: typeFilter ? [typeFilter as "SERVICE"] : undefined,
      statuses: statusFilter ? [statusFilter as "BOOKED"] : undefined,
      sources: sourceFilter ? [sourceFilter as "STAFF"] : undefined,
    },
    { enabled: Boolean(site.siteId), refetchInterval: 60_000 },
  );
  const capacity = trpc.planning.capacity.useQuery(
    { siteId: site.siteId ?? "", from, to },
    { enabled: Boolean(site.siteId) },
  );

  const onError = (err: { message: string }) => {
    const domain = domainCodeOf(err);
    toast.push(
      "err",
      domain ? t("appointments.toasts.conflict", { message: err.message }) : err.message,
    );
  };
  const update = trpc.appointment.update.useMutation({
    onSuccess(result) {
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push(
        "ok",
        result.rescheduled ? t("appointments.toasts.moved") : t("appointments.toasts.updated"),
      );
    },
    onError,
  });

  const data = list.data;
  const timeZone = data?.timeZone ?? tz;
  const openingHours = (data?.site.openingHours ?? {}) as Record<string, Array<[string, string]>>;
  const dayRanges = openingRanges(openingHours, day, data?.lunchBreak ?? null);
  const dayMinutes = dayRanges.reduce((n, [s, e]) => n + (e - s), 0);

  const columns = useMemo(() => {
    if (!data) return [];
    if (view === "mechanic")
      return mechanicColumns(data.mechanics, data.blocks, data.appointments, dayMinutes);
    return bayColumns(data.bays);
  }, [data, view, dayMinutes]);

  const dayCapacity = (capacity.data ?? []).filter((c) => c.date === day);

  if (!site.isLoading && !site.siteId) {
    return <EmptyState title={t("common.allSites")} description={t("common.genericError")} />;
  }

  return (
    <>
      <PageHead
        title={t("appointments.planningTitle")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setSlotOpen(true)}>
              {t("appointments.actions.findSlot")}
            </Button>
            {site.can("appointment:create") ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setCreateAt({
                      startsAt: instantAt(day, "09:00", timeZone),
                      bayId: null,
                      source: "PHONE",
                    })
                  }
                >
                  {t("appointments.actions.newPhone")}
                </Button>
                <Button onClick={() => router.push("/rendez-vous/nouveau")}>
                  {t("appointments.actions.new")}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <div className="pl-toolbar">
        <div className="pl-date">
          <button
            type="button"
            className="icon-btn"
            aria-label={t("appointments.actions.prev")}
            onClick={() => setDay(addDays(day, view === "week" ? -7 : -1))}
          >
            ◀
          </button>
          <span className="label">
            {view === "week"
              ? `${formatLongDay(weekStart, timeZone)} →`
              : formatLongDay(day, timeZone)}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("appointments.actions.next")}
            onClick={() => setDay(addDays(day, view === "week" ? 7 : 1))}
          >
            ▶
          </button>
          <Button size="sm" variant="ghost" onClick={() => setDay(civilDay(new Date(), timeZone))}>
            {t("appointments.actions.today")}
          </Button>
          <input
            type="date"
            className="input"
            style={{ height: 36, width: 150 }}
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            aria-label={t("appointments.fields.date")}
          />
        </div>
        <div className="pl-views" role="tablist">
          {(["bay", "mechanic", "week", "list"] as View[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={view === key ? "active" : ""}
              onClick={() => setView(key)}
            >
              {t(
                `appointments.views.${key === "bay" ? "dayByBay" : key === "mechanic" ? "dayByMechanic" : key}`,
              )}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="pl-filters">
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label={t("appointments.filters.type")}
          >
            <option value="">
              {t("appointments.filters.type")} : {t("appointments.filters.all")}
            </option>
            {APPOINTMENT_TYPES.map((k) => (
              <option key={k} value={k}>
                {typeLabel(k)}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t("appointments.filters.status")}
          >
            <option value="">
              {t("appointments.filters.status")} : {t("appointments.filters.all")}
            </option>
            {APPOINTMENT_STATUSES.map((k) => (
              <option key={k} value={k}>
                {statusLabel(k)}
              </option>
            ))}
          </Select>
          <Select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label={t("appointments.filters.source")}
          >
            <option value="">
              {t("appointments.filters.source")} : {t("appointments.filters.all")}
            </option>
            {APPOINTMENT_SOURCES.map((k) => (
              <option key={k} value={k}>
                {sourceLabel(k)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {view !== "week" && dayCapacity.length > 0 ? (
        <div className="pl-capacity">
          {dayCapacity.map((c) => {
            const tone = c.occupancy > 0.9 ? "bad" : c.occupancy >= 0.7 ? "warn" : "";
            return (
              <div key={`${c.date}-${c.halfDay}`} className={["pl-gauge", tone].join(" ")}>
                <div className="head">
                  <span>
                    {t("appointments.capacity.label", {
                      period:
                        c.halfDay === "AM"
                          ? t("appointments.capacity.am")
                          : t("appointments.capacity.pm"),
                    })}
                  </span>
                  <span className="num">
                    {t("appointments.capacity.value", {
                      load: formatHours(c.loadMinutes),
                      capacity: formatHours(c.capacityMinutes),
                    })}{" "}
                    · {t("appointments.capacity.appointments", { count: c.appointmentsCount })}
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.round(c.occupancy * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {list.isLoading || !data ? <div className="skeleton pl-skel" /> : null}
      {list.error ? <div className="pl-error-box">{list.error.message}</div> : null}

      {data && (view === "bay" || view === "mechanic") ? (
        data.appointments.length === 0 && dayRanges.length === 0 ? (
          <EmptyState
            title={t("appointments.empty.title")}
            description={t("appointments.empty.description")}
          />
        ) : (
          <PlanningGrid
            day={day}
            timeZone={timeZone}
            openingHours={openingHours}
            lunchBreak={data.lunchBreak}
            columns={columns}
            appointments={data.appointments}
            blocks={data.blocks}
            occupyingOrders={data.occupyingOrders}
            canUpdate={site.can("appointment:update")}
            onSelect={setSelected}
            onCreate={(startsAt, bayId) =>
              site.can("appointment:create") && setCreateAt({ startsAt, bayId })
            }
            onMove={(input) =>
              update.mutate({
                id: input.id,
                startsAt: input.startsAt,
                bayId: input.bayId,
                mechanicId: input.mechanicId,
                notifyCustomer: true,
                force: input.force && site.can("planning:manage"),
              })
            }
            onResize={(input) =>
              update.mutate({
                id: input.id,
                durationMinutes: input.durationMinutes,
                notifyCustomer: false,
                force: false,
              })
            }
          />
        )
      ) : null}

      {data && view === "week" ? (
        <WeekView
          weekStart={weekStart}
          timeZone={timeZone}
          appointments={data.appointments}
          capacity={capacity.data ?? []}
          onSelectDay={(d) => {
            setDay(d);
            setView("bay");
          }}
          onSelect={setSelected}
        />
      ) : null}

      {data && view === "list" ? (
        <ListView timeZone={timeZone} appointments={data.appointments} onSelect={setSelected} />
      ) : null}

      {selected ? (
        <AppointmentPanel
          appointmentId={selected}
          bays={data?.bays ?? []}
          canForce={site.can("planning:manage")}
          canCancel={site.can("appointment:cancel")}
          canUpdate={site.can("appointment:update")}
          onClose={() => {
            setSelected(null);
            router.replace("/rendez-vous");
          }}
        />
      ) : null}

      <Modal
        open={Boolean(createAt)}
        onClose={() => setCreateAt(null)}
        title={t("appointments.newTitle")}
        size="lg"
      >
        {createAt && data && site.siteId ? (
          <AppointmentForm
            siteId={site.siteId}
            timeZone={timeZone}
            durations={data.settings.durations}
            bays={data.bays}
            mechanics={data.mechanics}
            canForce={site.can("planning:manage")}
            initial={{
              startsAt: createAt.startsAt,
              bayId: createAt.bayId,
              source: createAt.source,
            }}
            onCreated={(id) => {
              setCreateAt(null);
              setSelected(id);
            }}
            onCancel={() => setCreateAt(null)}
          />
        ) : null}
      </Modal>

      {site.siteId ? (
        <FindSlotDialog
          open={slotOpen}
          onClose={() => setSlotOpen(false)}
          siteId={site.siteId}
          timeZone={timeZone}
          type="SERVICE"
          fromDay={day}
          onPick={(slot) => {
            setSlotOpen(false);
            setCreateAt({ startsAt: slot.startsAt, bayId: slot.bayId });
          }}
        />
      ) : null}
    </>
  );
}
