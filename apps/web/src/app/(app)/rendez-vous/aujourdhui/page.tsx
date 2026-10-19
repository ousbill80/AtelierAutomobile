"use client";

// §7 `/(app)/rendez-vous/aujourdhui` — liste du jour pour l'accueil (écran principal mobile) :
// à venir, en retard (rouge), arrivés, absents ; compteur ; « Confirmations à obtenir par
// téléphone ». Actions rapides : Client arrivé, Appeler, Marquer confirmé, Marquer absent.
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AppointmentPanel } from "../appointment-panel";
import { AppointmentRow } from "../appointment-row";
import { errorInfo, ta } from "../labels";
import type { PlanningAppointment } from "../types";
import { ErrorBox, SidePanel, Toast, type ToastState } from "../ui-bits";

export default function TodayPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const me = trpc.me.get.useQuery();
  const permissions = useMemo(() => new Set<string>(me.data?.permissions ?? []), [me.data]);
  const today = trpc.appointment.today.useQuery({});
  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const showToast = useCallback(
    (message: string, tone: "ok" | "bad" = "ok") => setToast({ message, tone }),
    [],
  );
  const onError = (e: Parameters<typeof errorInfo>[0]) =>
    showToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
  const refresh = () => utils.appointment.invalidate();
  const arrived = trpc.appointment.markArrived.useMutation({
    onSuccess(result) {
      refresh();
      if (result.receptionUrl) router.push(result.receptionUrl);
    },
    onError,
  });
  const confirm = trpc.appointment.confirm.useMutation({
    onSuccess: () => {
      refresh();
      showToast(ta("panel.confirmed"));
    },
    onError,
  });
  const noShow = trpc.appointment.markNoShow.useMutation({ onSuccess: refresh, onError });
  const canUpdate = permissions.has("appointment:update");

  const d = today.data;
  const tz = d?.timeZone ?? "Africa/Abidjan";

  const actions: ActionHandlers = {
    canUpdate,
    onArrived: (id) => arrived.mutate({ id }),
    onConfirm: (id) => confirm.mutate({ id, via: "phone" }),
    onNoShow: (id) => noShow.mutate({ id }),
  };

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-16">
      <h1 className="text-2xl font-semibold">{ta("todayPage.title")}</h1>
      {today.isLoading && (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-24" />
          ))}
        </div>
      )}
      {today.isError && <ErrorBox message={ta("loadError")} onRetry={() => today.refetch()} />}
      {d && (
        <>
          <p className="text-sm font-medium" data-testid="today-summary">
            {ta("todayPage.summary", {
              total: d.counts.total,
              confirmed: d.counts.confirmed,
              unanswered: d.counts.unanswered,
            })}
          </p>
          {d.counts.total === 0 && d.phoneConfirmations.length === 0 ? (
            <EmptyState title={ta("todayPage.empty")} description={ta("empty")} />
          ) : (
            <>
              <Section
                title={ta("todayPage.late")}
                items={d.late}
                tone="bad"
                tz={tz}
                onSelect={setSelected}
                actions={actions}
              />
              <Section
                title={ta("todayPage.upcoming")}
                items={d.upcoming}
                tz={tz}
                onSelect={setSelected}
                actions={actions}
              />
              <Section
                title={ta("todayPage.arrived")}
                items={d.arrived}
                tz={tz}
                onSelect={setSelected}
                actions={actions}
              />
              <Section
                title={ta("todayPage.noShow")}
                items={d.noShow}
                tz={tz}
                onSelect={setSelected}
                actions={actions}
              />
            </>
          )}
          <section className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <h2 className="text-base font-semibold">{ta("todayPage.phoneConfirmations")}</h2>
            <p className="text-sm text-muted">{ta("todayPage.phoneConfirmationsHint")}</p>
            {d.phoneConfirmations.length === 0 && (
              <p className="text-sm text-muted">{ta("todayPage.nothing")}</p>
            )}
            {d.phoneConfirmations.map((a) => (
              <div key={a.id} className="flex flex-col gap-2">
                <AppointmentRow a={a} tz={tz} onSelect={setSelected} />
                <Actions a={a} {...actions} />
              </div>
            ))}
          </section>
        </>
      )}
      <SidePanel open={!!selected} title={ta("panel.title")} onClose={() => setSelected(null)}>
        {selected && (
          <AppointmentPanel
            id={selected}
            permissions={permissions}
            onToast={showToast}
            onChanged={() => today.refetch()}
          />
        )}
      </SidePanel>
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

interface ActionHandlers {
  canUpdate: boolean;
  onArrived: (id: string) => void;
  onConfirm: (id: string) => void;
  onNoShow: (id: string) => void;
}

function Actions({
  a,
  canUpdate,
  onArrived,
  onConfirm,
  onNoShow,
}: { a: PlanningAppointment } & ActionHandlers) {
  const pending = a.status === "BOOKED" || a.status === "CONFIRMED";
  return (
    <div className="flex flex-wrap gap-2">
      {a.customer.phone && (
        <a href={`tel:${a.customer.phone}`} className="btn btn-secondary btn-sm min-h-11">
          <Phone size={14} aria-hidden /> {ta("panel.call")}
        </a>
      )}
      {pending && canUpdate && (
        <Button size="sm" className="min-h-11" onClick={() => onArrived(a.id)}>
          {ta("panel.arrived")}
        </Button>
      )}
      {a.status === "BOOKED" && canUpdate && (
        <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onConfirm(a.id)}>
          {ta("statuses.CONFIRMED")}
        </Button>
      )}
      {pending && canUpdate && (
        <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onNoShow(a.id)}>
          {ta("panel.noShow")}
        </Button>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  tone,
  tz,
  onSelect,
  actions,
}: {
  title: string;
  items: PlanningAppointment[];
  tone?: "bad";
  tz: string;
  onSelect: (id: string) => void;
  actions: ActionHandlers;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className={`text-base font-semibold ${tone === "bad" ? "text-status-bad" : ""}`}>
        {title} ({items.length})
      </h2>
      {items.length === 0 && <p className="text-sm text-muted">{ta("todayPage.nothing")}</p>}
      {items.map((a) => (
        <div key={a.id} className="flex flex-col gap-2">
          <AppointmentRow a={a} tz={tz} onSelect={onSelect} />
          <Actions a={a} {...actions} />
        </div>
      ))}
    </section>
  );
}
