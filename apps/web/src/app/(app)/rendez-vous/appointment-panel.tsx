"use client";

// §7 « Panneau RDV » : client (fiche, Appeler, WhatsApp), véhicule (VT / révision), type, motif,
// durée, pont, mécanicien, conseiller, source et relance d'origine, messages liés ; actions
// Confirmer, Client arrivé (→ réception M04), Déplacer, Annuler (motif), Marquer absent,
// Envoyer un rappel, Corriger une absence, Terminer sans OR, Ouvrir l'OR.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Bell, MessageCircle, Phone } from "lucide-react";
import { Button, CheckboxRow, Field, Input, Modal, Select, Textarea } from "@atelieros/ui";
import { formatDate } from "@atelieros/core/planning";
import { trpc } from "@/trpc/react";
import {
  SourceIcon,
  StatusLabel,
  TypeDot,
  dayKeyOf,
  errorInfo,
  fmtDay,
  fmtTime,
  instantOf,
  ta,
  type AppointmentSource,
  type AppointmentStatus,
  type AppointmentType,
} from "./labels";
import { REMINDER_TYPE_LABELS } from "../relances/reminder-labels";
import { ErrorBox } from "./ui-bits";

const CANCEL_REASONS = [
  "PART_UNAVAILABLE",
  "WORKSHOP_OVERLOADED",
  "MECHANIC_ABSENT",
  "DUPLICATE",
  "OTHER",
] as const;

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, "")}`;
}

export function AppointmentPanel({
  id,
  permissions,
  onToast,
  onChanged,
}: {
  id: string;
  permissions: Set<string>;
  onToast: (message: string, tone?: "ok" | "bad") => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.appointment.get.useQuery({ id });
  const [modal, setModal] = useState<null | "cancel" | "move" | "revert" | "complete">(null);
  const [reason, setReason] = useState("");
  const [cancel, setCancel] = useState<{
    by: "GARAGE" | "CUSTOMER";
    code: (typeof CANCEL_REASONS)[number];
    details: string;
    notify: boolean;
  }>({
    by: "GARAGE",
    code: "PART_UNAVAILABLE",
    details: "",
    notify: true,
  });
  const [move, setMove] = useState({ date: "", time: "", bayId: "", notify: true });

  const refresh = () => {
    utils.appointment.invalidate();
    utils.planning.invalidate();
    onChanged();
  };
  const onError = (e: Parameters<typeof errorInfo>[0]) =>
    onToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad");
  const done = (message: string) => () => {
    setModal(null);
    setReason("");
    onToast(message);
    refresh();
  };

  const confirm = trpc.appointment.confirm.useMutation({
    onSuccess: done(ta("panel.confirmed")),
    onError,
  });
  const arrived = trpc.appointment.markArrived.useMutation({
    onSuccess(result) {
      refresh();
      if (result.receptionUrl) router.push(result.receptionUrl);
    },
    onError,
  });
  const noShow = trpc.appointment.markNoShow.useMutation({
    onSuccess: done(ta("statuses.NO_SHOW")),
    onError,
  });
  const revert = trpc.appointment.revertNoShow.useMutation({
    onSuccess: done(ta("statuses.ARRIVED")),
    onError,
  });
  const complete = trpc.appointment.complete.useMutation({
    onSuccess: done(ta("statuses.COMPLETED")),
    onError,
  });
  const cancelMutation = trpc.appointment.cancel.useMutation({
    onSuccess: done(ta("cancel.done")),
    onError,
  });
  const cancelGroup = trpc.appointment.cancelGroup.useMutation({
    onSuccess: done(ta("cancel.done")),
    onError,
  });
  const reminder = trpc.appointment.sendReminderNow.useMutation({
    onSuccess: done(ta("panel.reminderSent")),
    onError,
  });
  const noShowMessage = trpc.appointment.sendNoShowMessage.useMutation({
    onSuccess: done(ta("panel.noShowMessageSent")),
    onError,
  });
  const update = trpc.appointment.update.useMutation({ onSuccess: done(ta("moved")), onError });
  const bays = trpc.appointment.list.useQuery(
    {
      siteId: query.data?.siteId,
      from: query.data ? new Date(query.data.startsAt) : new Date(),
      to: query.data ? new Date(query.data.endsAt) : new Date(),
    },
    { enabled: modal === "move" && !!query.data },
  );

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-12" />
        ))}
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorBox message={ta("panel.loadError")} onRetry={() => query.refetch()} />;
  }

  const a = query.data;
  const tz = a.timeZone;
  const status = a.status as AppointmentStatus;
  const can = (p: string) => permissions.has(p);
  const pending = status === "BOOKED" || status === "CONFIRMED";
  const phone = a.customer.whatsappPhone ?? a.customer.phone;

  return (
    <div className="flex flex-col gap-4" data-testid="appointment-panel">
      <div className="flex flex-wrap items-center gap-2">
        <StatusLabel status={status} />
        <TypeDot type={a.type as AppointmentType} />
        <SourceIcon source={a.source as AppointmentSource} />
        {a.overbooked && (
          <span className="pill pill-warn">
            <AlertTriangle size={13} aria-hidden /> {ta("badges.overbooked")}
          </span>
        )}
        {a.outsideHours && <span className="pill pill-warn">{ta("badges.outsideHours")}</span>}
        {a.flags.noShowCount >= 2 && (
          <span className="pill pill-bad">
            {ta("badges.noShows", { count: a.flags.noShowCount })}
          </span>
        )}
        {a.flags.late && <span className="pill pill-bad">{ta("badges.late")}</span>}
      </div>

      <section className="flex flex-col gap-2 rounded-md border border-border p-3">
        <Link
          href={`/clients/${a.customer.id}`}
          className="font-semibold underline-offset-2 hover:underline"
        >
          {a.customer.displayName}
        </Link>
        <div className="flex flex-wrap gap-2">
          {a.customer.phone && (
            <a href={`tel:${a.customer.phone}`} className="btn btn-secondary btn-sm min-h-11">
              <Phone size={14} aria-hidden /> {ta("panel.call")}
            </a>
          )}
          {phone && (
            <a
              href={waLink(phone)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary btn-sm min-h-11"
            >
              <MessageCircle size={14} aria-hidden /> {ta("panel.whatsapp")}
            </a>
          )}
        </div>
        {a.vehicle ? (
          <div className="text-sm">
            <p>
              {[a.vehicle.make, a.vehicle.model].filter(Boolean).join(" ")} —{" "}
              <strong>{a.vehicle.plate}</strong>
            </p>
            {a.vehicle.inspectionExpiryDate && (
              <p className="text-muted">
                {ta("panel.inspection", {
                  date: formatDate(new Date(a.vehicle.inspectionExpiryDate), "UTC"),
                })}
              </p>
            )}
            {a.vehicle.nextServiceDueDate && (
              <p className="text-muted">
                {ta("panel.service", {
                  date: formatDate(new Date(a.vehicle.nextServiceDueDate), "UTC"),
                })}
              </p>
            )}
          </div>
        ) : (
          <span className="pill pill-warn self-start">{ta("badges.vehicleToIdentify")}</span>
        )}
      </section>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">{ta("panel.when")}</dt>
        <dd data-testid="panel-when">
          {fmtDay(a.startsAt, tz)} · {fmtTime(a.startsAt, tz)}–{fmtTime(a.endsAt, tz)}
        </dd>
        <dt className="text-muted">{ta("panel.bay")}</dt>
        <dd>{a.bay?.name ?? ta("unassigned")}</dd>
        <dt className="text-muted">{ta("panel.mechanic")}</dt>
        <dd>{a.mechanicName ?? ta("form.noMechanic")}</dd>
        <dt className="text-muted">{ta("panel.advisor")}</dt>
        <dd>{a.advisorName ?? "—"}</dd>
        <dt className="text-muted">{ta("panel.source")}</dt>
        <dd>{ta(`sources.${a.source}`)}</dd>
        {a.reminder && (
          <>
            <dt className="text-muted">
              <Bell size={14} aria-label={ta("sources.REMINDER")} />
            </dt>
            <dd>
              {ta("panel.fromReminder", {
                type: REMINDER_TYPE_LABELS[a.reminder.type] ?? a.reminder.type,
                step: a.reminder.stepKey,
              })}
            </dd>
          </>
        )}
        {a.complaint && (
          <>
            <dt className="text-muted">{ta("panel.complaint")}</dt>
            <dd className="whitespace-pre-line">{a.complaint}</dd>
          </>
        )}
        {a.notes && (
          <>
            <dt className="text-muted">{ta("panel.notes")}</dt>
            <dd className="whitespace-pre-line">{a.notes}</dd>
          </>
        )}
        {a.confirmedVia && (
          <>
            <dt className="text-muted">{ta("statuses.CONFIRMED")}</dt>
            <dd>{ta(`via.${a.confirmedVia}`)}</dd>
          </>
        )}
      </dl>

      <div className="flex flex-col gap-2">
        {status === "BOOKED" && can("appointment:update") && (
          <Button
            variant="secondary"
            className="min-h-11"
            loading={confirm.isPending}
            onClick={() => confirm.mutate({ id, via: "phone" })}
          >
            {ta("panel.confirm")}
          </Button>
        )}
        {pending && can("appointment:update") && (
          <Button
            className="min-h-11"
            loading={arrived.isPending}
            onClick={() => arrived.mutate({ id })}
          >
            {ta("panel.arrived")}
          </Button>
        )}
        {pending && can("appointment:update") && (
          <Button
            variant="secondary"
            className="min-h-11"
            onClick={() => {
              setMove({
                date: dayKeyOf(a.startsAt, tz),
                time: fmtTime(a.startsAt, tz),
                bayId: a.bayId ?? "",
                notify: true,
              });
              setModal("move");
            }}
          >
            {ta("panel.move")}
          </Button>
        )}
        {pending && can("appointment:update") && (
          <Button
            variant="secondary"
            className="min-h-11"
            loading={reminder.isPending}
            onClick={() => reminder.mutate({ id })}
          >
            {ta("panel.sendReminder")}
          </Button>
        )}
        {pending && can("appointment:update") && (
          <Button
            variant="ghost"
            className="min-h-11"
            loading={noShow.isPending}
            onClick={() => noShow.mutate({ id })}
          >
            {ta("panel.noShow")}
          </Button>
        )}
        {status === "NO_SHOW" && can("appointment:update") && (
          <>
            <Button
              variant="secondary"
              className="min-h-11"
              loading={noShowMessage.isPending}
              onClick={() => noShowMessage.mutate({ id })}
            >
              {ta("panel.sendNoShowMessage")}
            </Button>
            {a.canRevertNoShow && (
              <Button variant="ghost" className="min-h-11" onClick={() => setModal("revert")}>
                {ta("panel.revertNoShow")}
              </Button>
            )}
          </>
        )}
        {status === "ARRIVED" && a.repairOrder && (
          <Link href={`/ordres/${a.repairOrder.id}`} className="btn btn-primary min-h-11">
            {ta("panel.openOrder", { number: a.repairOrder.number })}
          </Link>
        )}
        {status === "ARRIVED" && can("appointment:update") && (
          <Button variant="secondary" className="min-h-11" onClick={() => setModal("complete")}>
            {ta("panel.complete")}
          </Button>
        )}
        {pending && can("appointment:cancel") && (
          <Button variant="danger" className="min-h-11" onClick={() => setModal("cancel")}>
            {ta("panel.cancel")}
          </Button>
        )}
        {pending && a.groupId && can("planning:manage") && (
          <Button
            variant="danger"
            className="min-h-11"
            loading={cancelGroup.isPending}
            onClick={() => cancelGroup.mutate({ id })}
          >
            {ta("panel.cancelGroup")}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{ta("panel.messages")}</h3>
        {a.messages.length === 0 && <p className="text-sm text-muted">{ta("panel.noMessages")}</p>}
        {a.messages.map((m) => (
          <div key={m.id} className="rounded-md bg-surface-2 p-2 text-xs">
            <p className="mb-1 text-muted">
              {m.channel} · {m.status} · {fmtDay(m.createdAt, tz)} {fmtTime(m.createdAt, tz)}
            </p>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        ))}
      </section>

      <Modal
        open={modal === "cancel"}
        title={ta("cancel.title")}
        onClose={() => setModal(null)}
        footer={
          <Button
            variant="danger"
            loading={cancelMutation.isPending}
            onClick={() =>
              cancelMutation.mutate({
                id,
                cancelledBy: cancel.by,
                reasonCode: cancel.by === "GARAGE" ? cancel.code : undefined,
                reason: cancel.details || undefined,
                notifyCustomer: cancel.notify,
              })
            }
          >
            {ta("cancel.submit")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={ta("cancel.by")}>
            <Select
              value={cancel.by}
              onChange={(e) =>
                setCancel({ ...cancel, by: e.target.value as "GARAGE" | "CUSTOMER" })
              }
            >
              <option value="GARAGE">{ta("cancel.byGarage")}</option>
              <option value="CUSTOMER">{ta("cancel.byCustomer")}</option>
            </Select>
          </Field>
          {cancel.by === "GARAGE" && (
            <Field label={ta("cancel.reason")}>
              <Select
                value={cancel.code}
                onChange={(e) =>
                  setCancel({ ...cancel, code: e.target.value as (typeof CANCEL_REASONS)[number] })
                }
              >
                {CANCEL_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {ta(`cancel.reasons.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Input
            label={ta("cancel.details")}
            value={cancel.details}
            onChange={(e) => setCancel({ ...cancel, details: e.target.value })}
          />
          {cancel.by === "GARAGE" && (
            <CheckboxRow
              label={ta("cancel.notify")}
              checked={cancel.notify}
              onChange={(e) => setCancel({ ...cancel, notify: e.target.checked })}
            />
          )}
        </div>
      </Modal>

      <Modal
        open={modal === "move"}
        title={ta("move.title")}
        onClose={() => setModal(null)}
        footer={
          <Button
            loading={update.isPending}
            onClick={() =>
              update.mutate({
                id,
                startsAt: instantOf(move.date, move.time, tz),
                bayId: move.bayId || null,
                notifyCustomer: move.notify,
                force: false,
              })
            }
          >
            {ta("move.submit")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={ta("form.date")}
            type="date"
            value={move.date}
            onChange={(e) => setMove({ ...move, date: e.target.value })}
          />
          <Input
            label={ta("form.time")}
            type="time"
            step={900}
            value={move.time}
            onChange={(e) => setMove({ ...move, time: e.target.value })}
          />
          <Field label={ta("form.bay")}>
            <Select
              value={move.bayId}
              onChange={(e) => setMove({ ...move, bayId: e.target.value })}
            >
              <option value="">{ta("unassigned")}</option>
              {bays.data?.bays.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <CheckboxRow
            label={ta("notifyOnMove")}
            checked={move.notify}
            onChange={(e) => setMove({ ...move, notify: e.target.checked })}
          />
        </div>
      </Modal>

      <Modal
        open={modal === "revert" || modal === "complete"}
        title={ta("reason.title")}
        onClose={() => setModal(null)}
        footer={
          <Button
            loading={revert.isPending || complete.isPending}
            onClick={() =>
              modal === "revert" ? revert.mutate({ id, reason }) : complete.mutate({ id, reason })
            }
          >
            {ta("reason.submit")}
          </Button>
        }
      >
        <Field label={ta("reason.label")}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </Field>
      </Modal>
    </div>
  );
}
