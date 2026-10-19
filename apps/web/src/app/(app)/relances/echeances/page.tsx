"use client";

import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { Button, DataTable, EmptyState, Field, Input, Modal, PageHead, Tabs } from "@atelieros/ui";
import type { AppRouter } from "@/server/routers/_app";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DueItem = RouterOutputs["reminders"]["dueDates"]["items"][number];

const KINDS = ["INSPECTION", "SERVICE", "INSURANCE"] as const;
type Kind = (typeof KINDS)[number];

const FILTERS = [
  "",
  "DUE_SOON_7",
  "DUE_SOON_30",
  "OVERDUE",
  "UPCOMING",
  "INCOMPLETE_DATA",
  "SUSPECT_DATE",
] as const;
type Filter = (typeof FILTERS)[number];

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayKey(date: Date): string {
  return `${monthKey(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function DueDatesPage() {
  const [kind, setKind] = useState<Kind>("INSPECTION");
  const [filter, setFilter] = useState<Filter>("");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [doneModal, setDoneModal] = useState<DueItem | null>(null);
  const [expiryDate, setExpiryDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [center, setCenter] = useState("");
  const [apptModal, setApptModal] = useState<DueItem | null>(null);
  const [apptDate, setApptDate] = useState("");
  const [createAppointment, setCreateAppointment] = useState(true);

  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const canApprove = new Set(me.data?.permissions ?? []).has("reminder:approve");

  const listQuery = trpc.reminders.dueDates.useQuery({
    kind,
    filter: filter || undefined,
    limit: 100,
  });
  const calendarQuery = trpc.reminders.dueDates.useQuery(
    { kind, limit: 200 },
    { enabled: view === "calendar" },
  );

  const markInspectionDone = trpc.reminders.markInspectionDone.useMutation({
    onSuccess() {
      setDoneModal(null);
      setExpiryDate("");
      setLastDate("");
      setCenter("");
      utils.reminders.dueDates.invalidate();
    },
  });
  const markAppointmentTaken = trpc.reminders.markAppointmentTaken.useMutation({
    onSuccess() {
      setApptModal(null);
      setApptDate("");
      utils.reminders.dueDates.invalidate();
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, DueItem[]>();
    for (const item of calendarQuery.data?.items ?? []) {
      if (!item.dueDate) continue;
      const key = dayKey(new Date(item.dueDate));
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [calendarQuery.data]);

  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const monthEnd = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
  const leadingBlanks = (monthStart.getDay() + 6) % 7; // semaine commence lundi
  const days: Date[] = [];
  for (let d = 1; d <= monthEnd.getDate(); d++) {
    days.push(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), d));
  }
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  return (
    <>
      <PageHead
        title={t("reminders.dueDates.title")}
        description={t("reminders.dueDates.description")}
      />
      <Tabs
        items={KINDS.map((k) => ({ key: k, label: t(`reminders.dueDates.kinds.${k}`) }))}
        activeKey={kind}
        onChange={(k) => {
          setKind(k as Kind);
          setSelectedDay(null);
        }}
      />
      <div className="row-actions">
        <Tabs
          items={[
            { key: "list", label: t("reminders.dueDates.views.list") },
            { key: "calendar", label: t("reminders.dueDates.views.calendar") },
          ]}
          activeKey={view}
          onChange={(v) => setView(v as "list" | "calendar")}
        />
      </div>

      {view === "list" ? (
        <>
          <div className="row-actions">
            {FILTERS.map((f) => (
              <Button
                key={f || "ALL"}
                variant={filter === f ? "primary" : "secondary"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f ? t(`reminders.dueDates.filters.${f}`) : t("reminders.dueDates.filters.all")}
              </Button>
            ))}
          </div>
          {listQuery.isLoading ? (
            <p>{t("common.loading")}</p>
          ) : listQuery.isError ? (
            <EmptyState title={t("common.genericError")} />
          ) : (
            <DataTable<DueItem>
              columns={[
                {
                  key: "vehicle",
                  header: t("reminders.dueDates.table.vehicle"),
                  primary: true,
                  render: (row) => `${row.make} ${row.model} (${row.plate})`,
                },
                {
                  key: "customer",
                  header: t("reminders.dueDates.table.customer"),
                  render: (row) => row.customer.displayName,
                },
                {
                  key: "due",
                  header: t("reminders.dueDates.table.due"),
                  render: (row) =>
                    row.dueDate ? new Date(row.dueDate).toLocaleDateString("fr-FR") : "—",
                },
                {
                  key: "countdown",
                  header: t("reminders.dueDates.table.countdown"),
                  render: (row) =>
                    row.isSuspect ? (
                      <span className="pill pill-warn">
                        <span className="dot" />
                        {t("reminders.dueDates.suspectBadge")}
                      </span>
                    ) : (
                      (row.countdown ?? "—")
                    ),
                },
                {
                  key: "actions",
                  header: "",
                  render: (row) =>
                    canApprove ? (
                      <div className="row-actions">
                        {kind === "INSPECTION" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDoneModal(row);
                              setExpiryDate("");
                              setLastDate("");
                              setCenter("");
                            }}
                          >
                            {t("reminders.dueDates.markDoneAction")}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setApptModal(row);
                            setApptDate("");
                            setCreateAppointment(true);
                          }}
                        >
                          {t("reminders.dueDates.markAppointmentAction")}
                        </Button>
                      </div>
                    ) : null,
                },
              ]}
              rows={listQuery.data?.items ?? []}
              rowKey={(row) => row.vehicleId}
              empty={
                <EmptyState
                  title={t("reminders.dueDates.empty.title")}
                  description={t("reminders.dueDates.empty.description")}
                />
              }
            />
          )}
        </>
      ) : calendarQuery.isLoading ? (
        <p>{t("common.loading")}</p>
      ) : calendarQuery.isError ? (
        <EmptyState title={t("common.genericError")} />
      ) : (
        <div className="stack">
          <div className="row-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
                )
              }
            >
              {t("common.back")}
            </Button>
            <strong>
              {calendarMonth.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}
            </strong>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
                )
              }
            >
              {t("common.next")}
            </Button>
          </div>
          <div className="calendar-grid">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} className="calendar-cell empty" />
            ))}
            {days.map((day) => {
              const key = dayKey(day);
              const count = byDay.get(key)?.length ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    "calendar-cell",
                    count > 0 ? "has-items" : "",
                    selectedDay === key ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedDay(key)}
                >
                  <span>{day.getDate()}</span>
                  {count > 0 ? <span className="badge">{count}</span> : null}
                </button>
              );
            })}
          </div>
          {selectedDay && byDay.get(selectedDay)?.length ? (
            <DataTable<DueItem>
              columns={[
                {
                  key: "vehicle",
                  header: t("reminders.dueDates.table.vehicle"),
                  primary: true,
                  render: (row) => `${row.make} ${row.model} (${row.plate})`,
                },
                {
                  key: "customer",
                  header: t("reminders.dueDates.table.customer"),
                  render: (row) => row.customer.displayName,
                },
              ]}
              rows={byDay.get(selectedDay) ?? []}
              rowKey={(row) => row.vehicleId}
            />
          ) : null}
        </div>
      )}

      <Modal
        open={doneModal != null}
        title={t("reminders.dueDates.markDoneModal.title")}
        onClose={() => setDoneModal(null)}
        footer={
          <Button
            onClick={() => {
              if (!doneModal || !expiryDate) return;
              markInspectionDone.mutate({
                vehicleId: doneModal.vehicleId,
                expiryDate: new Date(expiryDate),
                lastDate: lastDate ? new Date(lastDate) : undefined,
                center: center.trim() || undefined,
              });
            }}
            loading={markInspectionDone.isPending}
            disabled={!expiryDate}
          >
            {t("reminders.dueDates.markDoneModal.submit")}
          </Button>
        }
      >
        <Field label={t("reminders.dueDates.markDoneModal.expiryLabel")}>
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
        </Field>
        <Field label={t("reminders.dueDates.markDoneModal.lastDateLabel")}>
          <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
        </Field>
        <Field label={t("reminders.dueDates.markDoneModal.centerLabel")}>
          <Input value={center} onChange={(e) => setCenter(e.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={apptModal != null}
        title={t("reminders.dueDates.markAppointmentModal.title")}
        onClose={() => setApptModal(null)}
        footer={
          <Button
            onClick={() => {
              if (!apptModal) return;
              markAppointmentTaken.mutate({
                vehicleId: apptModal.vehicleId,
                date: apptDate ? new Date(apptDate) : undefined,
                createAppointment,
              });
            }}
            loading={markAppointmentTaken.isPending}
          >
            {t("reminders.dueDates.markAppointmentModal.submit")}
          </Button>
        }
      >
        <Field label={t("reminders.dueDates.markAppointmentModal.dateLabel")}>
          <Input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)} />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={createAppointment}
            onChange={(e) => setCreateAppointment(e.target.checked)}
          />
          <span>{t("reminders.dueDates.markAppointmentModal.createAppointment")}</span>
        </label>
      </Modal>
    </>
  );
}
