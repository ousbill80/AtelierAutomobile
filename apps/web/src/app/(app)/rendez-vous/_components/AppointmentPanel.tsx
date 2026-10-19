"use client";

import { useState } from "react";
import {
  Button,
  CheckboxRow,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Textarea,
  TypeBadge,
} from "@atelieros/ui";
import { CANCEL_REASONS } from "@atelieros/validators";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import {
  SOURCE_ICONS,
  STATUS_META,
  TYPE_COLORS,
  sourceLabel,
  statusLabel,
  typeLabel,
} from "../_lib/labels";
import {
  civilDay,
  formatDate,
  formatDateTime,
  formatLongDay,
  formatTime,
  instantAt,
} from "../_lib/time";
import { domainCodeOf, useToast } from "../_lib/useToast";
import type { PlanningBay } from "../_lib/types";

export interface AppointmentPanelProps {
  appointmentId: string;
  bays: PlanningBay[];
  canForce: boolean;
  canCancel: boolean;
  canUpdate: boolean;
  onClose: () => void;
}

/** Panneau latéral « RDV » (M03 §7) : détail + actions (confirmer, arrivé, déplacer, annuler, absent, rappel). */
export function AppointmentPanel(props: AppointmentPanelProps) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const detail = trpc.appointment.get.useQuery({ id: props.appointmentId });
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [revertOpen, setRevertOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  function refresh() {
    utils.appointment.invalidate();
    utils.planning.invalidate();
  }
  const onError = (err: { message: string }) => toast.push("err", err.message);

  const confirm = trpc.appointment.confirm.useMutation({
    onSuccess: () => {
      refresh();
      toast.push("ok", t("appointments.toasts.confirmed"));
    },
    onError,
  });
  const arrive = trpc.appointment.markArrived.useMutation({
    onSuccess(result) {
      refresh();
      toast.push("ok", t("appointments.toasts.arrived"));
      if (result.receptionUrl) window.location.assign(result.receptionUrl);
    },
    onError,
  });
  const noShow = trpc.appointment.markNoShow.useMutation({
    onSuccess: () => {
      refresh();
      toast.push("ok", t("appointments.toasts.noShow"));
    },
    onError,
  });
  const reminder = trpc.appointment.sendReminderNow.useMutation({
    onSuccess: () => {
      refresh();
      toast.push("ok", t("appointments.toasts.reminderSent"));
    },
    onError,
  });
  const noShowMessage = trpc.appointment.sendNoShowMessage.useMutation({
    onSuccess: () => {
      refresh();
      toast.push("ok", t("appointments.toasts.reminderSent"));
    },
    onError,
  });
  const link = trpc.appointment.createPortalLink.useMutation({
    async onSuccess(result) {
      await navigator.clipboard?.writeText(result.url).catch(() => undefined);
      toast.push("ok", t("appointments.toasts.linkCopied"));
    },
    onError,
  });

  const a = detail.data;
  const tz = a?.timeZone ?? "Africa/Abidjan";

  return (
    <>
      <div className="pl-panel-backdrop" onClick={props.onClose} />
      <aside className="pl-panel" role="dialog" aria-label={t("appointments.panel.title")}>
        <div className="head">
          <h3>{t("appointments.panel.title")}</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label={t("common.close")}
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <div className="body">
          {detail.isLoading ? <div className="skeleton" style={{ height: 240 }} /> : null}
          {detail.error ? <div className="pl-error-box">{detail.error.message}</div> : null}
          {a ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  className="pl-type"
                  style={{ ["--type-color" as string]: TYPE_COLORS[a.type] }}
                >
                  <span className="sw" /> {typeLabel(a.type)}
                </span>
                <StatusBadge
                  tone={STATUS_META[a.status].tone}
                  label={`${STATUS_META[a.status].icon} ${statusLabel(a.status)}`}
                />
                <span className="pl-src" title={sourceLabel(a.source)}>
                  {SOURCE_ICONS[a.source]} {sourceLabel(a.source)}
                </span>
                {a.overbooked ? (
                  <span className="pl-flag">⚠ {t("appointments.badges.overbooked")}</span>
                ) : null}
                {a.outsideHours ? (
                  <span className="pl-flag off">{t("appointments.badges.outsideHours")}</span>
                ) : null}
                {a.flags.late ? (
                  <span className="pl-flag bad">{t("appointments.badges.late")}</span>
                ) : null}
                {a.flags.noShowCount12m >= 2 ? (
                  <span className="pl-flag bad">
                    {t("appointments.badges.noShows", { count: a.flags.noShowCount12m })}
                  </span>
                ) : null}
                {a.reminderId ? (
                  <span className="pl-flag off">🔔 {t("appointments.badges.fromReminder")}</span>
                ) : null}
              </div>

              <div className="section-label">{t("appointments.panel.customerSection")}</div>
              <dl className="pl-kv">
                <dt>{t("appointments.fields.customer")}</dt>
                <dd>
                  <b>{a.customer.displayName}</b>
                </dd>
                <dt>{t("appointments.actions.call")}</dt>
                <dd>
                  {a.customer.phone ? (
                    <a className="num" href={`tel:${a.customer.phone}`}>
                      {a.customer.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                  {a.customer.phone && a.customer.hasWhatsapp !== false ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={`https://wa.me/${(a.customer.whatsappPhone ?? a.customer.phone).replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("appointments.actions.whatsapp")}
                      </a>
                    </>
                  ) : null}
                  {!a.flags.reachable ? (
                    <span className="pl-flag off" style={{ marginLeft: 6 }}>
                      {t("appointments.badges.unreachable")}
                    </span>
                  ) : null}
                </dd>
              </dl>

              <div className="section-label">{t("appointments.panel.vehicleSection")}</div>
              <dl className="pl-kv">
                <dt>{t("appointments.fields.vehicle")}</dt>
                <dd>
                  {a.vehicle ? (
                    <>
                      {a.vehicle.make} {a.vehicle.model}{" "}
                      <span className="veh-plate">{a.vehicle.plate}</span>
                    </>
                  ) : (
                    <span className="pl-flag off">{t("appointments.fields.noVehicle")}</span>
                  )}
                </dd>
                {a.vehicle ? (
                  <>
                    <dt>VT</dt>
                    <dd>
                      {a.vehicle.inspectionExpiryDate
                        ? formatDate(a.vehicle.inspectionExpiryDate, tz)
                        : t("appointments.panel.unknown")}
                      {a.flags.inspectionStatus === "DUE_SOON" ? (
                        <span className="pl-flag" style={{ marginLeft: 6 }}>
                          {t("appointments.badges.inspectionSoon")}
                        </span>
                      ) : null}
                      {a.flags.inspectionStatus === "EXPIRED" ? (
                        <span className="pl-flag bad" style={{ marginLeft: 6 }}>
                          {t("appointments.badges.inspectionExpired")}
                        </span>
                      ) : null}
                    </dd>
                    <dt>{typeLabel("SERVICE")}</dt>
                    <dd>
                      {a.vehicle.nextServiceDueDate
                        ? formatDate(a.vehicle.nextServiceDueDate, tz)
                        : t("appointments.panel.unknown")}
                      {a.flags.serviceStatus === "DUE_SOON" ||
                      a.flags.serviceStatus === "OVERDUE" ? (
                        <span className="pl-flag" style={{ marginLeft: 6 }}>
                          {t("appointments.badges.serviceDue")}
                        </span>
                      ) : null}
                    </dd>
                  </>
                ) : null}
              </dl>

              <div className="section-label">{t("appointments.panel.planningSection")}</div>
              <dl className="pl-kv">
                <dt>{t("appointments.fields.date")}</dt>
                <dd style={{ textTransform: "capitalize" }}>
                  {formatLongDay(a.startsAt, tz)} · {formatTime(a.startsAt, tz)}–
                  {formatTime(a.endsAt, tz)}
                </dd>
                <dt>{t("appointments.fields.duration")}</dt>
                <dd>{t("appointments.panel.durationValue", { minutes: a.durationMinutes })}</dd>
                <dt>{t("appointments.fields.bay")}</dt>
                <dd>{a.bay?.name ?? t("appointments.fields.unassignedBay")}</dd>
                <dt>{t("appointments.fields.mechanic")}</dt>
                <dd>{a.mechanicName ?? t("appointments.fields.noMechanic")}</dd>
                <dt>{t("appointments.fields.advisor")}</dt>
                <dd>{a.advisorName ?? "—"}</dd>
                <dt>{t("appointments.fields.complaint")}</dt>
                <dd>{a.complaint ?? "—"}</dd>
                {a.laborOperations.length > 0 ? (
                  <>
                    <dt>{t("appointments.panel.laborOperations")}</dt>
                    <dd>
                      {a.laborOperations
                        .map((op) => `${op.name} (${op.standardHours} h)`)
                        .join(", ")}
                    </dd>
                  </>
                ) : null}
                {a.notes ? (
                  <>
                    <dt>{t("appointments.fields.notes")}</dt>
                    <dd>{a.notes}</dd>
                  </>
                ) : null}
                {a.reminder ? (
                  <>
                    <dt>🔔</dt>
                    <dd>
                      {t("appointments.panel.originReminder", {
                        type: a.reminder.type,
                        step: a.reminder.stepKey,
                      })}
                    </dd>
                  </>
                ) : null}
                {a.confirmedAt ? (
                  <>
                    <dt>✔</dt>
                    <dd>
                      {t("appointments.panel.confirmedInfo", {
                        via: a.confirmedVia ? t(`appointments.confirmVia.${a.confirmedVia}`) : "—",
                      })}{" "}
                      · {formatDateTime(a.confirmedAt, tz)}
                    </dd>
                  </>
                ) : null}
                {a.arrivedAt ? (
                  <>
                    <dt>🚗</dt>
                    <dd>
                      {t("appointments.panel.arrivedInfo", { time: formatTime(a.arrivedAt, tz) })}
                    </dd>
                  </>
                ) : null}
                {a.noShowAt ? (
                  <>
                    <dt>✖</dt>
                    <dd>
                      {t("appointments.panel.noShowInfo", { date: formatDateTime(a.noShowAt, tz) })}
                    </dd>
                  </>
                ) : null}
                {a.cancelledAt ? (
                  <>
                    <dt>⊘</dt>
                    <dd>
                      {t("appointments.panel.cancelledInfo", {
                        date: formatDateTime(a.cancelledAt, tz),
                        by: a.cancelledBy === "CUSTOMER" ? "client" : "garage",
                        reason: a.cancelReason ?? "—",
                      })}
                    </dd>
                  </>
                ) : null}
              </dl>

              <div className="section-label">{t("appointments.panel.messagesSection")}</div>
              {a.messages.length === 0 ? (
                <p className="hint">{t("appointments.panel.noMessages")}</p>
              ) : null}
              {a.messages.map((m) => (
                <div key={m.id} className="pl-msg">
                  <div className="meta">
                    {formatDateTime(m.createdAt, tz)} · {m.channel} · {m.status} ·{" "}
                    <span className="num">{m.to}</span>
                  </div>
                  {m.body}
                </div>
              ))}
              {a.operatingMode === "REMINDERS_ONLY" ? (
                <p className="hint">{t("appointments.reminderOnlyHint")}</p>
              ) : null}
            </>
          ) : null}
        </div>
        {a && props.canUpdate ? (
          <div className="foot">
            {a.status === "BOOKED" ? (
              <Button
                size="sm"
                onClick={() => confirm.mutate({ id: a.id, via: "phone" })}
                loading={confirm.isPending}
              >
                {t("appointments.actions.markConfirmedByPhone")}
              </Button>
            ) : null}
            {a.status === "BOOKED" || a.status === "CONFIRMED" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => arrive.mutate({ id: a.id })}
                  loading={arrive.isPending}
                >
                  {t("appointments.actions.arrived")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setMoveOpen(true)}>
                  {t("appointments.actions.move")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => reminder.mutate({ id: a.id })}
                  loading={reminder.isPending}
                >
                  {t("appointments.actions.sendReminder")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => link.mutate({ id: a.id })}
                  loading={link.isPending}
                >
                  {t("appointments.actions.copyPortalLink")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => noShow.mutate({ id: a.id })}
                  loading={noShow.isPending}
                >
                  {t("appointments.actions.noShow")}
                </Button>
                {props.canCancel ? (
                  <Button size="sm" variant="danger" onClick={() => setCancelOpen(true)}>
                    {t("appointments.actions.cancel")}
                  </Button>
                ) : null}
              </>
            ) : null}
            {a.status === "ARRIVED" ? (
              <>
                {a.operatingMode !== "REMINDERS_ONLY" && a.repairOrderId ? (
                  <TypeBadge label={t("appointments.actions.openOrder")} />
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => setCompleteOpen(true)}>
                  {t("appointments.actions.completeWithoutOrder")}
                </Button>
              </>
            ) : null}
            {a.status === "NO_SHOW" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => noShowMessage.mutate({ id: a.id })}
                  loading={noShowMessage.isPending}
                >
                  {t("appointments.actions.sendNoShowMessage")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setRevertOpen(true)}>
                  {t("appointments.actions.revertNoShow")}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </aside>

      {a ? (
        <>
          <MoveDialog
            open={moveOpen}
            onClose={() => setMoveOpen(false)}
            appointment={a}
            bays={props.bays}
            canForce={props.canForce}
            timeZone={tz}
          />
          <CancelDialog
            open={cancelOpen}
            onClose={() => setCancelOpen(false)}
            appointmentId={a.id}
          />
          <ReasonDialog
            open={revertOpen}
            onClose={() => setRevertOpen(false)}
            title={t("appointments.noShowDialog.title")}
            hint={t("appointments.noShowDialog.hint")}
            onSubmit={(reason) => revertNoShowMutationFactory(utils, toast)(a.id, reason)}
          />
          <ReasonDialog
            open={completeOpen}
            onClose={() => setCompleteOpen(false)}
            title={t("appointments.completeDialog.title")}
            hint={t("appointments.completeDialog.hint")}
            onSubmit={(reason) => completeMutationFactory(utils, toast)(a.id, reason)}
          />
        </>
      ) : null}
    </>
  );
}

function revertNoShowMutationFactory(
  utils: ReturnType<typeof trpc.useUtils>,
  toast: ReturnType<typeof useToast>,
) {
  return async (id: string, reason: string) => {
    try {
      await utils.client.appointment.revertNoShow.mutate({ id, reason });
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push("ok", t("appointments.toasts.updated"));
    } catch (err) {
      toast.push("err", (err as Error).message);
    }
  };
}

function completeMutationFactory(
  utils: ReturnType<typeof trpc.useUtils>,
  toast: ReturnType<typeof useToast>,
) {
  return async (id: string, reason: string) => {
    try {
      await utils.client.appointment.complete.mutate({ id, reason });
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push("ok", t("appointments.toasts.updated"));
    } catch (err) {
      toast.push("err", (err as Error).message);
    }
  };
}

function ReasonDialog(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  hint: string;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={props.open} onClose={props.onClose} title={props.title}>
      <p className="hint">{props.hint}</p>
      <Field label={t("appointments.fields.reason")}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button
        block
        disabled={!reason.trim()}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await props.onSubmit(reason.trim());
          setBusy(false);
          setReason("");
          props.onClose();
        }}
      >
        {t("common.confirm")}
      </Button>
    </Modal>
  );
}

function CancelDialog(props: { open: boolean; onClose: () => void; appointmentId: string }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [cancelledBy, setCancelledBy] = useState<"GARAGE" | "CUSTOMER">("GARAGE");
  const [reason, setReason] = useState<string>(CANCEL_REASONS[0]);
  const [other, setOther] = useState("");
  const [notify, setNotify] = useState(true);
  const cancel = trpc.appointment.cancel.useMutation({
    onSuccess() {
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push("ok", t("appointments.toasts.cancelled"));
      props.onClose();
    },
    onError: (err) => toast.push("err", err.message),
  });
  const finalReason = reason === "Autre" ? other.trim() : reason;
  return (
    <Modal open={props.open} onClose={props.onClose} title={t("appointments.cancelDialog.title")}>
      <Field label={t("appointments.fields.cancelledBy")}>
        <Select
          value={cancelledBy}
          onChange={(e) => setCancelledBy(e.target.value as "GARAGE" | "CUSTOMER")}
        >
          <option value="GARAGE">Garage</option>
          <option value="CUSTOMER">Client</option>
        </Select>
      </Field>
      <Field label={t("appointments.fields.cancelReason")}>
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          {CANCEL_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>
      {reason === "Autre" ? (
        <Field label={t("appointments.fields.reason")}>
          <Input value={other} onChange={(e) => setOther(e.target.value)} />
        </Field>
      ) : null}
      <CheckboxRow
        label={t("appointments.fields.notifyCustomer")}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />
      <div style={{ height: 12 }} />
      <Button
        block
        variant="danger"
        loading={cancel.isPending}
        disabled={cancelledBy === "GARAGE" && !finalReason}
        onClick={() =>
          cancel.mutate({
            id: props.appointmentId,
            cancelledBy,
            reason: finalReason || undefined,
            notifyCustomer: notify,
          })
        }
      >
        {t("appointments.actions.cancel")}
      </Button>
    </Modal>
  );
}

function MoveDialog(props: {
  open: boolean;
  onClose: () => void;
  appointment: { id: string; startsAt: Date; bayId: string | null; durationMinutes: number };
  bays: PlanningBay[];
  canForce: boolean;
  timeZone: string;
}) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const tz = props.timeZone;
  const [day, setDay] = useState(civilDay(props.appointment.startsAt, tz));
  const [time, setTime] = useState(formatTime(props.appointment.startsAt, tz));
  const [bayId, setBayId] = useState(props.appointment.bayId ?? "");
  const [duration, setDuration] = useState(props.appointment.durationMinutes);
  const [notify, setNotify] = useState(true);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = trpc.appointment.update.useMutation({
    onSuccess() {
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push("ok", t("appointments.toasts.moved"));
      props.onClose();
    },
    onError(err) {
      setError(err.message);
      if (domainCodeOf(err))
        toast.push("err", t("appointments.toasts.conflict", { message: err.message }));
    },
  });
  return (
    <Modal open={props.open} onClose={props.onClose} title={t("appointments.move.title")}>
      <div className="pl-inline">
        <Field label={t("appointments.move.newDate")}>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label={t("appointments.move.newTime")}>
          <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <div className="pl-inline">
        <Field label={t("appointments.move.newBay")}>
          <Select value={bayId} onChange={(e) => setBayId(e.target.value)}>
            <option value="">{t("appointments.fields.unassignedBay")}</option>
            {props.bays.map((bay) => (
              <option key={bay.id} value={bay.id}>
                {bay.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("appointments.fields.duration")}>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
      </div>
      <CheckboxRow
        label={t("appointments.fields.notifyCustomer")}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />
      {props.canForce ? (
        <CheckboxRow
          label={t("appointments.fields.force")}
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
        />
      ) : null}
      {error ? (
        <div className="pl-error-box" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
      <div style={{ height: 12 }} />
      <Button
        block
        loading={update.isPending}
        onClick={() =>
          update.mutate({
            id: props.appointment.id,
            startsAt: instantAt(day, time, tz),
            bayId: bayId || null,
            durationMinutes: duration,
            notifyCustomer: notify,
            force,
          })
        }
      >
        {t("appointments.actions.move")}
      </Button>
    </Modal>
  );
}
