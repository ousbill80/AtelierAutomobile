"use client";

// §7 `/(app)/rendez-vous/aujourdhui` — liste du jour pour l'accueil (écran principal mobile) :
// à venir, en retard (rouge), arrivés, absents ; compteur ; « Confirmations à obtenir par
// téléphone ». Actions rapides : Client arrivé, Appeler, Marquer confirmé, Marquer absent.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Car,
  CircleCheck,
  Clock,
  Hourglass,
  Phone,
  PhoneCall,
  Plus,
  TriangleAlert,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { Button, EmptyState } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import { AppointmentPanel } from "../appointment-panel";
import { AppointmentRow } from "../appointment-row";
import { errorInfo, fmtDay, instantOf, ta } from "../labels";
import type { PlanningAppointment } from "../types";
import { ErrorBox, SidePanel, Toast, type ToastState } from "../ui-bits";

type Tone = "neutral" | "ok" | "warn" | "bad";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  ok: "text-status-ok",
  warn: "text-status-warn",
  bad: "text-status-bad",
};

const TONE_ICON_BG: Record<Tone, string> = {
  neutral: "bg-surface-2 text-foreground",
  ok: "bg-status-ok-bg text-status-ok",
  warn: "bg-status-warn-bg text-status-warn",
  bad: "bg-status-bad-bg text-status-bad",
};

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
  const canCreate = permissions.has("appointment:create");

  const d = today.data;
  const tz = d?.timeZone ?? "Africa/Abidjan";

  const actions: ActionHandlers = {
    canUpdate,
    onArrived: (id) => arrived.mutate({ id }),
    onConfirm: (id) => confirm.mutate({ id, via: "phone" }),
    onNoShow: (id) => noShow.mutate({ id }),
  };
  const listProps = { tz, onSelect: setSelected, actions };

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{ta("todayPage.title")}</h1>
          {d && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted first-letter:uppercase">
              <CalendarDays size={14} aria-hidden />
              {fmtDay(instantOf(d.date, "12:00", tz), tz)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/rendez-vous" className="btn btn-secondary min-h-11">
            <CalendarDays size={16} aria-hidden /> {ta("todayPage.openPlanning")}
          </Link>
          {canCreate && (
            <Link href="/rendez-vous/nouveau" className="btn btn-primary min-h-11">
              <Plus size={16} aria-hidden /> {ta("newAppointment")}
            </Link>
          )}
        </div>
      </header>

      {today.isLoading && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20" />
            ))}
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-32" />
          ))}
        </div>
      )}
      {today.isError && <ErrorBox message={ta("loadError")} onRetry={() => today.refetch()} />}
      {d && (
        <>
          <div
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
            data-testid="today-summary"
            aria-label={ta("todayPage.summary", {
              total: d.counts.total,
              confirmed: d.counts.confirmed,
              unanswered: d.counts.unanswered,
            })}
          >
            <Kpi icon={CalendarDays} label={ta("todayPage.kpiTotal")} value={d.counts.total} />
            <Kpi
              icon={CircleCheck}
              label={ta("todayPage.kpiConfirmed")}
              value={d.counts.confirmed}
              tone="ok"
            />
            <Kpi
              icon={Hourglass}
              label={ta("todayPage.kpiUnanswered")}
              value={d.counts.unanswered}
              tone={d.counts.unanswered > 0 ? "warn" : "neutral"}
            />
            <Kpi
              icon={TriangleAlert}
              label={ta("todayPage.kpiLate")}
              value={d.late.length}
              tone={d.late.length > 0 ? "bad" : "neutral"}
            />
          </div>

          {d.counts.total === 0 && d.phoneConfirmations.length === 0 ? (
            <EmptyState title={ta("todayPage.empty")} description={ta("empty")} />
          ) : (
            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
              <div className="flex min-w-0 flex-col gap-5">
                {d.late.length > 0 && (
                  <Section
                    icon={TriangleAlert}
                    title={ta("todayPage.late")}
                    items={d.late}
                    tone="bad"
                    {...listProps}
                  />
                )}
                <Section
                  icon={Clock}
                  title={ta("todayPage.upcoming")}
                  items={d.upcoming}
                  {...listProps}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-5">
                <Section
                  icon={Car}
                  title={ta("todayPage.arrived")}
                  items={d.arrived}
                  tone="ok"
                  {...listProps}
                />
                <Section
                  icon={UserX}
                  title={ta("todayPage.noShow")}
                  items={d.noShow}
                  {...listProps}
                />
                <Section
                  icon={PhoneCall}
                  title={ta("todayPage.phoneConfirmations")}
                  hint={ta("todayPage.phoneConfirmationsHint")}
                  items={d.phoneConfirmations}
                  tone="warn"
                  {...listProps}
                />
              </div>
            </div>
          )}
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

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: Tone;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${TONE_ICON_BG[tone]}`}
      >
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className={`text-2xl leading-none font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
          {value}
        </div>
        <div className="mt-1 truncate text-xs font-medium text-muted">{label}</div>
      </div>
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
  const hasAny = !!a.customer.phone || (pending && canUpdate);
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {pending && canUpdate && (
        <Button size="sm" className="min-h-11" onClick={() => onArrived(a.id)}>
          <Car size={14} aria-hidden /> {ta("panel.arrived")}
        </Button>
      )}
      {a.status === "BOOKED" && canUpdate && (
        <Button size="sm" variant="secondary" className="min-h-11" onClick={() => onConfirm(a.id)}>
          <CircleCheck size={14} aria-hidden /> {ta("statuses.CONFIRMED")}
        </Button>
      )}
      {a.customer.phone && (
        <a href={`tel:${a.customer.phone}`} className="btn btn-secondary btn-sm min-h-11">
          <Phone size={14} aria-hidden /> {ta("panel.call")}
        </a>
      )}
      {pending && canUpdate && (
        <Button size="sm" variant="ghost" className="min-h-11" onClick={() => onNoShow(a.id)}>
          <UserX size={14} aria-hidden /> {ta("panel.noShow")}
        </Button>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  hint,
  items,
  tone,
  tz,
  onSelect,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  items: PlanningAppointment[];
  tone?: Exclude<Tone, "neutral">;
  tz: string;
  onSelect: (id: string) => void;
  actions: ActionHandlers;
}) {
  const highlighted = tone === "bad" && items.length > 0;
  return (
    <section
      className={`overflow-hidden rounded-lg border bg-surface ${highlighted ? "border-status-bad" : "border-border"}`}
    >
      <header className="flex flex-col gap-1 border-b border-border bg-bg px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_ICON_BG[tone ?? "neutral"]}`}
          >
            <Icon size={14} aria-hidden />
          </span>
          <span className={`min-w-0 flex-1 ${tone === "bad" ? "text-status-bad" : ""}`}>
            {title}
          </span>
          <span className="pill pill-type tabular-nums">{items.length}</span>
        </h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </header>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">{ta("todayPage.nothing")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="flex flex-col [&>button]:border-b-0">
              <AppointmentRow a={a} tz={tz} onSelect={onSelect} />
              <Actions a={a} {...actions} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
