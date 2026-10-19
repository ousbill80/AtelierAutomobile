"use client";

// US-M03-10 — `/parametres/planning` : durées par type, pas, capacité, productivité, pause,
// portail (types, délai, horizon, validation), et indisponibilités (pont / mécanicien / site).
// Les jours fériés restent gérés dans Paramètres › Sites (modèle Holiday, 04 A1).
import { useMemo, useState } from "react";
import Link from "next/link";
import { Button, CheckboxRow, Field, Input, Select } from "@atelieros/ui";
import { addDaysToKey, localDateKey } from "@atelieros/core/planning";
import type { PlanningSettingsInput } from "@atelieros/validators";
import { trpc } from "@/trpc/react";
import { TYPES, errorInfo, fmtDay, fmtTime, instantOf, ta } from "../../rendez-vous/labels";
import { ErrorBox, Toast, type ToastState } from "../../rendez-vous/ui-bits";

export default function PlanningSettingsPage() {
  const me = trpc.me.get.useQuery();
  const canManage = (me.data?.permissions ?? []).includes("planning:manage");
  const settings = trpc.planningSettings.get.useQuery();
  const [toast, setToast] = useState<ToastState>(null);

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold">{ta("settings.title")}</h1>
        <p className="text-sm text-muted">{ta("settings.description")}</p>
      </div>
      {!canManage && me.data && <p className="alert-banner warn">{ta("settings.forbidden")}</p>}
      {settings.isLoading && <div className="skeleton h-96" />}
      {settings.isError && (
        <ErrorBox message={ta("loadError")} onRetry={() => settings.refetch()} />
      )}
      {settings.data && (
        <SettingsForm
          key={JSON.stringify(settings.data)}
          initial={settings.data as PlanningSettingsInput}
          disabled={!canManage}
          onToast={(message, tone) => setToast({ message, tone })}
        />
      )}
      <BlocksSection
        canManage={canManage}
        timeZone={me.data?.activeOrganization?.timezone ?? "Africa/Abidjan"}
        onToast={(message, tone) => setToast({ message, tone })}
      />
      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function SettingsForm({
  initial,
  disabled,
  onToast,
}: {
  initial: PlanningSettingsInput;
  disabled: boolean;
  onToast: (message: string, tone: "ok" | "bad") => void;
}) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState<PlanningSettingsInput>(initial);
  const save = trpc.planningSettings.update.useMutation({
    onSuccess() {
      utils.planningSettings.invalidate();
      utils.planning.invalidate();
      onToast(ta("settings.saved"), "ok");
    },
    onError: (e) => onToast(errorInfo(e)?.message ?? ta("errors.generic"), "bad"),
  });
  const a = value.appointments;
  const p = value.planning;
  const setA = (patch: Partial<PlanningSettingsInput["appointments"]>) =>
    setValue({ ...value, appointments: { ...a, ...patch } });
  const setP = (patch: Partial<PlanningSettingsInput["planning"]>) =>
    setValue({ ...value, planning: { ...p, ...patch } });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value);
      }}
    >
      <fieldset
        disabled={disabled}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <legend className="px-1 font-semibold">{ta("settings.durations")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TYPES.map((type) => (
            <Input
              key={type}
              label={ta(`types.${type}`)}
              type="number"
              min={15}
              step={15}
              value={a.durations[type]}
              onChange={(e) =>
                setA({ durations: { ...a.durations, [type]: Number(e.target.value) } })
              }
              className="min-h-11"
            />
          ))}
        </div>
      </fieldset>

      <fieldset
        disabled={disabled}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <legend className="px-1 font-semibold">{ta("settings.grid")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={ta("settings.step")}>
            <Select
              value={a.slotStepMinutes}
              onChange={(e) => setA({ slotStepMinutes: Number(e.target.value) })}
              className="min-h-11"
            >
              {[15, 30, 60].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Input
            label={ta("settings.lateAfter")}
            type="number"
            min={15}
            value={a.lateAfterMinutes}
            onChange={(e) => setA({ lateAfterMinutes: Number(e.target.value) })}
            className="min-h-11"
          />
          <Input
            label={ta("settings.noShowTime")}
            type="time"
            value={a.noShowJobTime}
            onChange={(e) => setA({ noShowJobTime: e.target.value })}
            className="min-h-11"
          />
          <Input
            label={ta("settings.maxPerHalfDay")}
            hint={ta("settings.maxPerHalfDayHint")}
            type="number"
            min={1}
            value={a.maxAppointmentsPerHalfDay ?? ""}
            onChange={(e) =>
              setA({ maxAppointmentsPerHalfDay: e.target.value ? Number(e.target.value) : null })
            }
            className="min-h-11"
          />
          <Input
            label={ta("settings.productivity")}
            type="number"
            min={10}
            max={100}
            value={Math.round(p.productivityRate * 100)}
            onChange={(e) => setP({ productivityRate: Number(e.target.value) / 100 })}
            className="min-h-11"
          />
        </div>
        <CheckboxRow
          label={ta("settings.lunchBreakEnabled")}
          checked={!!p.lunchBreak}
          onChange={(e) => setP({ lunchBreak: e.target.checked ? ["12:30", "13:30"] : null })}
        />
        {p.lunchBreak && (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={ta("settings.lunchFrom")}
              type="time"
              value={p.lunchBreak[0]}
              onChange={(e) => setP({ lunchBreak: [e.target.value, p.lunchBreak![1]] })}
              className="min-h-11"
            />
            <Input
              label={ta("settings.lunchTo")}
              type="time"
              value={p.lunchBreak[1]}
              onChange={(e) => setP({ lunchBreak: [p.lunchBreak![0], e.target.value] })}
              className="min-h-11"
            />
          </div>
        )}
      </fieldset>

      <fieldset
        disabled={disabled}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
      >
        <legend className="px-1 font-semibold">{ta("settings.portal")}</legend>
        <CheckboxRow
          label={ta("settings.portalEnabled")}
          checked={a.portalEnabled}
          onChange={(e) => setA({ portalEnabled: e.target.checked })}
        />
        <Field label={ta("settings.portalTypes")}>
          <div className="flex flex-wrap gap-3">
            {TYPES.map((type) => (
              <CheckboxRow
                key={type}
                label={ta(`types.${type}`)}
                checked={a.portalTypes.includes(type)}
                onChange={(e) =>
                  setA({
                    portalTypes: e.target.checked
                      ? [...a.portalTypes, type]
                      : a.portalTypes.filter((x) => x !== type),
                  })
                }
              />
            ))}
          </div>
        </Field>
        <CheckboxRow
          label={ta("settings.portalApproval")}
          checked={a.portalRequiresApproval}
          onChange={(e) => setA({ portalRequiresApproval: e.target.checked })}
        />
        <CheckboxRow
          label={ta("settings.autoAssignBay")}
          checked={a.autoAssignBay}
          onChange={(e) => setA({ autoAssignBay: e.target.checked })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={ta("settings.portalLead")}
            type="number"
            min={0}
            value={a.portalMinLeadHours}
            onChange={(e) => setA({ portalMinLeadHours: Number(e.target.value) })}
            className="min-h-11"
          />
          <Input
            label={ta("settings.portalHorizon")}
            type="number"
            min={1}
            value={a.portalHorizonDays}
            onChange={(e) => setA({ portalHorizonDays: Number(e.target.value) })}
            className="min-h-11"
          />
        </div>
      </fieldset>

      <div className="rounded-lg border border-border p-4 text-sm">
        <p className="font-semibold">{ta("settings.holidays")}</p>
        <p className="text-muted">
          <Link href="/parametres/sites" className="underline">
            {ta("settings.holidaysHint")}
          </Link>
        </p>
      </div>

      {!disabled && (
        <Button type="submit" loading={save.isPending} className="min-h-11 self-start">
          {ta("settings.save")}
        </Button>
      )}
    </form>
  );
}

function BlocksSection({
  canManage,
  timeZone,
  onToast,
}: {
  canManage: boolean;
  timeZone: string;
  onToast: (message: string, tone: "ok" | "bad") => void;
}) {
  const utils = trpc.useUtils();
  const [now] = useState(() => new Date());
  const today = localDateKey(now, timeZone);
  const range = useMemo(
    () => ({
      from: instantOf(today, "00:00", timeZone),
      to: instantOf(addDaysToKey(today, 90), "00:00", timeZone),
    }),
    [today, timeZone],
  );
  const blocks = trpc.resourceBlock.list.useQuery(range);
  const columns = trpc.appointment.list.useQuery({ from: range.from, to: range.from });
  const [form, setForm] = useState({
    target: "",
    fromDate: today,
    fromTime: "07:30",
    toDate: today,
    toTime: "18:00",
    reason: "",
  });
  const [conflict, setConflict] = useState<string | null>(null);
  const create = trpc.resourceBlock.create.useMutation({
    onSuccess() {
      setConflict(null);
      setForm({ ...form, reason: "" });
      utils.resourceBlock.invalidate();
      utils.appointment.invalidate();
      onToast(ta("settings.blockCreated"), "ok");
    },
    onError(e) {
      const info = errorInfo(e);
      if (info?.code === "BLOCK_HAS_APPOINTMENTS" && info.forcible) setConflict(info.message);
      else onToast(info?.message ?? ta("errors.generic"), "bad");
    },
  });
  const remove = trpc.resourceBlock.delete.useMutation({
    onSuccess: () => utils.resourceBlock.invalidate(),
  });

  function submit(force: boolean) {
    const [kind, id] = form.target.split(":");
    create.mutate({
      bayId: kind === "bay" ? id : null,
      membershipId: kind === "mechanic" ? id : null,
      startsAt: instantOf(form.fromDate, form.fromTime, timeZone),
      endsAt: instantOf(form.toDate, form.toTime, timeZone),
      reason: form.reason,
      force,
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="font-semibold">{ta("settings.blocks")}</h2>
      {blocks.isLoading && <div className="skeleton h-16" />}
      {blocks.data && blocks.data.length === 0 && (
        <p className="text-sm text-muted">{ta("settings.blocksEmpty")}</p>
      )}
      <ul className="flex flex-col gap-2">
        {blocks.data?.map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 p-2 text-sm"
          >
            <span>
              <strong>
                {b.bay
                  ? ta("settings.blockBay", { name: b.bay.name })
                  : b.membership
                    ? ta("settings.blockMechanic", { name: b.membership.user.name })
                    : ta("settings.blockSite")}
              </strong>{" "}
              · {fmtDay(b.startsAt, timeZone)} {fmtTime(b.startsAt, timeZone)} →{" "}
              {fmtDay(b.endsAt, timeZone)} {fmtTime(b.endsAt, timeZone)} · {b.reason}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-11"
                onClick={() => remove.mutate({ id: b.id })}
              >
                {ta("settings.blockDelete")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <Field label={ta("settings.blockTarget")}>
            <Select
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              className="min-h-11"
            >
              <option value="">{ta("settings.blockSite")}</option>
              {columns.data?.bays.map((b) => (
                <option key={b.id} value={`bay:${b.id}`}>
                  {ta("settings.blockBay", { name: b.name })}
                </option>
              ))}
              {columns.data?.mechanics.map((m) => (
                <option key={m.id} value={`mechanic:${m.id}`}>
                  {ta("settings.blockMechanic", { name: m.name })}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={ta("settings.blockFrom")}
              type="date"
              value={form.fromDate}
              onChange={(e) => setForm({ ...form, fromDate: e.target.value })}
              className="min-h-11"
            />
            <Input
              label=" "
              aria-label={ta("settings.blockFrom")}
              type="time"
              value={form.fromTime}
              onChange={(e) => setForm({ ...form, fromTime: e.target.value })}
              className="min-h-11"
            />
            <Input
              label={ta("settings.blockTo")}
              type="date"
              value={form.toDate}
              onChange={(e) => setForm({ ...form, toDate: e.target.value })}
              className="min-h-11"
            />
            <Input
              label=" "
              aria-label={ta("settings.blockTo")}
              type="time"
              value={form.toTime}
              onChange={(e) => setForm({ ...form, toTime: e.target.value })}
              className="min-h-11"
            />
          </div>
          <Input
            label={ta("settings.blockReason")}
            placeholder={ta("settings.blockReasonPlaceholder")}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="min-h-11"
          />
          {conflict && (
            <div className="alert-banner warn flex-wrap">
              <span>{conflict}</span>
              <Button type="button" size="sm" variant="secondary" onClick={() => submit(true)}>
                {ta("settings.blockForce")}
              </Button>
            </div>
          )}
          <Button type="submit" loading={create.isPending} className="min-h-11 self-start">
            {ta("settings.blockAdd")}
          </Button>
        </form>
      )}
    </section>
  );
}
