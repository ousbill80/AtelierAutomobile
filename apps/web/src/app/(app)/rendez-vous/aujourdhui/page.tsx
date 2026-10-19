"use client";

import { useState } from "react";
import { Button, EmptyState, PageHead } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import "../planning.css";
import { AppointmentPanel } from "../_components/AppointmentPanel";
import { ListView } from "../_components/ListView";
import { formatLongDay } from "../_lib/time";
import { useActiveSite } from "../_lib/useActiveSite";
import { ToastProvider, useToast } from "../_lib/useToast";

export default function TodayPage() {
  return (
    <ToastProvider>
      <TodayScreen />
    </ToastProvider>
  );
}

/** `/rendez-vous/aujourdhui` — liste du jour pour l'accueil (M03 §7, US-M03-09). */
function TodayScreen() {
  const site = useActiveSite();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [selected, setSelected] = useState<string | null>(null);
  const today = trpc.appointment.today.useQuery(
    { siteId: site.siteId ?? "" },
    { enabled: Boolean(site.siteId), refetchInterval: 60_000 },
  );
  const list = trpc.appointment.list.useQuery(
    { siteId: site.siteId ?? "", from: new Date(0), to: new Date(1) },
    { enabled: Boolean(site.siteId) && Boolean(selected) },
  );
  const refresh = () => {
    utils.appointment.invalidate();
    utils.planning.invalidate();
  };
  const onError = (err: { message: string }) => toast.push("err", err.message);
  const arrive = trpc.appointment.markArrived.useMutation({
    onSuccess(r) {
      refresh();
      toast.push("ok", t("appointments.toasts.arrived"));
      if (r.receptionUrl) window.location.assign(r.receptionUrl);
    },
    onError,
  });
  const confirm = trpc.appointment.confirm.useMutation({
    onSuccess() {
      refresh();
      toast.push("ok", t("appointments.toasts.confirmed"));
    },
    onError,
  });
  const noShow = trpc.appointment.markNoShow.useMutation({
    onSuccess() {
      refresh();
      toast.push("ok", t("appointments.toasts.noShow"));
    },
    onError,
  });

  const data = today.data;
  const tz = data?.timeZone ?? "Africa/Abidjan";
  const canUpdate = site.can("appointment:update");
  const sections = data
    ? [
        {
          key: "late",
          label: t("appointments.today.sections.late"),
          items: data.appointments.filter((a) => a.flags.late),
        },
        {
          key: "upcoming",
          label: t("appointments.today.sections.upcoming"),
          items: data.appointments.filter(
            (a) => (a.status === "BOOKED" || a.status === "CONFIRMED") && !a.flags.late,
          ),
        },
        {
          key: "arrived",
          label: t("appointments.today.sections.arrived"),
          items: data.appointments.filter(
            (a) => a.status === "ARRIVED" || a.status === "COMPLETED",
          ),
        },
        {
          key: "noShow",
          label: t("appointments.today.sections.noShow"),
          items: data.appointments.filter((a) => a.status === "NO_SHOW"),
        },
        {
          key: "cancelled",
          label: t("appointments.today.sections.cancelled"),
          items: data.appointments.filter((a) => a.status === "CANCELLED"),
        },
      ].filter((s) => s.items.length > 0)
    : [];

  const actions = (a: (typeof sections)[number]["items"][number]) =>
    canUpdate ? (
      <>
        {a.status === "BOOKED" || a.status === "CONFIRMED" ? (
          <Button size="sm" onClick={() => arrive.mutate({ id: a.id })}>
            {t("appointments.actions.arrived")}
          </Button>
        ) : null}
        {a.status === "BOOKED" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => confirm.mutate({ id: a.id, via: "phone" })}
          >
            {t("appointments.actions.confirm")}
          </Button>
        ) : null}
        {a.customer.phone ? (
          <a className="btn btn-secondary btn-sm" href={`tel:${a.customer.phone}`}>
            {t("appointments.actions.call")}
          </a>
        ) : null}
        {a.flags.late ? (
          <Button size="sm" variant="danger" onClick={() => noShow.mutate({ id: a.id })}>
            {t("appointments.actions.noShow")}
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <>
      <PageHead
        title={t("appointments.todayTitle")}
        description={data ? formatLongDay(data.date, tz) : undefined}
      />
      {today.isLoading ? <div className="skeleton" style={{ height: 300 }} /> : null}
      {today.error ? <div className="pl-error-box">{today.error.message}</div> : null}
      {data ? (
        <>
          <div className="pl-counter">
            <span>
              {t("appointments.today.counter", {
                total: data.counters.total,
                confirmed: data.counters.confirmed,
                unanswered: data.counters.unanswered,
              })}
            </span>
          </div>
          {sections.length === 0 ? (
            <EmptyState
              title={t("appointments.today.empty")}
              description={t("appointments.empty.description")}
            />
          ) : null}
          {sections.map((section) => (
            <div key={section.key} style={{ marginBottom: 20 }}>
              <div className="section-label">
                {section.label} · {section.items.length}
              </div>
              <ListView
                timeZone={tz}
                appointments={section.items}
                onSelect={setSelected}
                actions={actions}
              />
            </div>
          ))}
          <div className="section-label">
            {t("appointments.today.sections.callsToMake")} · {data.callsToMake.length}
          </div>
          {data.callsToMake.length === 0 ? (
            <p className="hint">{t("appointments.today.callsEmpty")}</p>
          ) : (
            <ListView
              timeZone={tz}
              appointments={data.callsToMake}
              onSelect={setSelected}
              actions={actions}
            />
          )}
        </>
      ) : null}
      {selected ? (
        <AppointmentPanel
          appointmentId={selected}
          bays={list.data?.bays ?? []}
          canForce={site.can("planning:manage")}
          canCancel={site.can("appointment:cancel")}
          canUpdate={canUpdate}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
