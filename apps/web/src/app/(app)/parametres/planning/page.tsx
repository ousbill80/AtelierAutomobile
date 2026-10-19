"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CheckboxRow,
  EmptyState,
  Field,
  Input,
  PageHead,
  Select,
} from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import "../../rendez-vous/planning.css";
import {
  APPOINTMENT_TYPES,
  typeLabel,
  type AppointmentTypeKey,
} from "../../rendez-vous/_lib/labels";
import { formatDateTime, instantAt } from "../../rendez-vous/_lib/time";
import type { RouterOutputs } from "../../rendez-vous/_lib/types";
import { useActiveSite } from "../../rendez-vous/_lib/useActiveSite";
import { domainCodeOf, ToastProvider, useToast } from "../../rendez-vous/_lib/useToast";

export default function PlanningSettingsPage() {
  return (
    <ToastProvider>
      <PlanningSettingsScreen />
    </ToastProvider>
  );
}

/** `/parametres/planning` (US-M03-10) : durées, grille, capacité, portail, blocages. Jours fériés : `/parametres/sites` (M15). */
function PlanningSettingsScreen() {
  const site = useActiveSite();
  const settings = trpc.planning.getSettings.useQuery();

  if (!site.can("planning:manage")) {
    return <EmptyState title={t("common.unauthorized")} />;
  }

  return (
    <>
      <PageHead
        title={t("planningSettings.title")}
        description={t("planningSettings.description")}
      />
      {settings.isLoading ? <div className="skeleton" style={{ height: 300 }} /> : null}
      {settings.error ? <div className="pl-error-box">{settings.error.message}</div> : null}
      {settings.data ? <SettingsForm key={settings.dataUpdatedAt} initial={settings.data} /> : null}
      {site.siteId ? <BlocksCard siteId={site.siteId} /> : null}
    </>
  );
}

type SettingsData = RouterOutputs["planning"]["getSettings"];

/** Formulaire monté une fois les réglages chargés (état initial = valeurs serveur). */
function SettingsForm({ initial }: { initial: SettingsData }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [durations, setDurations] = useState<Record<string, number>>(
    initial.appointments.durations,
  );
  const [slotStep, setSlotStep] = useState<5 | 10 | 15 | 30>(
    initial.appointments.slotStepMinutes as 5 | 10 | 15 | 30,
  );
  const [lateAfter, setLateAfter] = useState(initial.appointments.lateAfterMinutes);
  const [noShowTime, setNoShowTime] = useState(initial.appointments.noShowJobTime);
  const [maxPerHalfDay, setMaxPerHalfDay] = useState<string>(
    initial.appointments.maxAppointmentsPerHalfDay?.toString() ?? "",
  );
  const [productivity, setProductivity] = useState(initial.planning.productivityRate);
  const [lunchEnabled, setLunchEnabled] = useState(Boolean(initial.planning.lunchBreak));
  const [lunch, setLunch] = useState<[string, string]>(
    initial.planning.lunchBreak ?? ["12:30", "13:30"],
  );
  const [portalEnabled, setPortalEnabled] = useState(initial.appointments.portalEnabled);
  const [portalTypes, setPortalTypes] = useState<AppointmentTypeKey[]>(
    initial.appointments.portalTypes as AppointmentTypeKey[],
  );
  const [portalLead, setPortalLead] = useState(initial.appointments.portalMinLeadHours);
  const [portalHorizon, setPortalHorizon] = useState(initial.appointments.portalHorizonDays);
  const [portalApproval, setPortalApproval] = useState(initial.appointments.portalRequiresApproval);
  const [autoAssign, setAutoAssign] = useState(initial.appointments.autoAssignBay);

  const update = trpc.planning.updateSettings.useMutation({
    onSuccess() {
      utils.planning.invalidate();
      toast.push("ok", t("planningSettings.saved"));
    },
    onError: (err) => toast.push("err", err.message),
  });

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({
          appointments: {
            durations: durations as Record<AppointmentTypeKey, number>,
            slotStepMinutes: slotStep,
            lateAfterMinutes: lateAfter,
            noShowJobTime: noShowTime,
            maxAppointmentsPerHalfDay: maxPerHalfDay ? Number(maxPerHalfDay) : null,
            portalEnabled,
            portalTypes,
            portalMinLeadHours: portalLead,
            portalHorizonDays: portalHorizon,
            portalRequiresApproval: portalApproval,
            autoAssignBay: autoAssign,
          },
          planning: { productivityRate: productivity, lunchBreak: lunchEnabled ? lunch : null },
        });
      }}
    >
      <Card title={t("planningSettings.sections.durations")}>
        <div className="grid-2">
          {APPOINTMENT_TYPES.map((type) => (
            <Field key={type} label={typeLabel(type)}>
              <Input
                type="number"
                min={15}
                step={15}
                value={durations[type] ?? 60}
                onChange={(e) => setDurations({ ...durations, [type]: Number(e.target.value) })}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card title={t("planningSettings.sections.grid")}>
        <div className="grid-2">
          <Field label={t("planningSettings.fields.slotStepMinutes")}>
            <Select
              value={slotStep}
              onChange={(e) => setSlotStep(Number(e.target.value) as 5 | 10 | 15 | 30)}
            >
              {[5, 10, 15, 30].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("planningSettings.fields.lateAfterMinutes")}>
            <Input
              type="number"
              min={0}
              max={240}
              value={lateAfter}
              onChange={(e) => setLateAfter(Number(e.target.value))}
            />
          </Field>
          <Field label={t("planningSettings.fields.noShowJobTime")}>
            <Input type="time" value={noShowTime} onChange={(e) => setNoShowTime(e.target.value)} />
          </Field>
          <Field
            label={t("planningSettings.fields.maxAppointmentsPerHalfDay")}
            hint={t("planningSettings.fields.maxAppointmentsAuto")}
          >
            <Input
              type="number"
              min={1}
              value={maxPerHalfDay}
              onChange={(e) => setMaxPerHalfDay(e.target.value)}
              placeholder={t("planningSettings.fields.maxAppointmentsAuto")}
            />
          </Field>
          <Field label={t("planningSettings.fields.productivityRate")}>
            <Input
              type="number"
              min={0.1}
              max={1}
              step={0.05}
              value={productivity}
              onChange={(e) => setProductivity(Number(e.target.value))}
            />
          </Field>
          <Field label={t("planningSettings.fields.lunchBreak")}>
            <div className="stack" style={{ gap: 8 }}>
              <CheckboxRow
                label={
                  lunchEnabled
                    ? `${lunch[0]} – ${lunch[1]}`
                    : t("planningSettings.fields.lunchBreakNone")
                }
                checked={lunchEnabled}
                onChange={(e) => setLunchEnabled(e.target.checked)}
              />
              {lunchEnabled ? (
                <div className="pl-inline">
                  <Input
                    type="time"
                    value={lunch[0]}
                    onChange={(e) => setLunch([e.target.value, lunch[1]])}
                    aria-label={t("planningSettings.blocks.from")}
                  />
                  <Input
                    type="time"
                    value={lunch[1]}
                    onChange={(e) => setLunch([lunch[0], e.target.value])}
                    aria-label={t("planningSettings.blocks.to")}
                  />
                </div>
              ) : null}
            </div>
          </Field>
        </div>
      </Card>

      <Card title={t("planningSettings.sections.portal")}>
        <div className="stack" style={{ gap: 10 }}>
          <CheckboxRow
            label={t("planningSettings.fields.portalEnabled")}
            checked={portalEnabled}
            onChange={(e) => setPortalEnabled(e.target.checked)}
          />
          <div className="section-label" style={{ margin: "6px 0" }}>
            {t("planningSettings.fields.portalTypes")}
          </div>
          <div className="grid-2">
            {APPOINTMENT_TYPES.map((type) => (
              <CheckboxRow
                key={type}
                label={typeLabel(type)}
                checked={portalTypes.includes(type)}
                onChange={(e) =>
                  setPortalTypes(
                    e.target.checked
                      ? [...portalTypes, type]
                      : portalTypes.filter((x) => x !== type),
                  )
                }
              />
            ))}
          </div>
          <div className="grid-2">
            <Field label={t("planningSettings.fields.portalMinLeadHours")}>
              <Input
                type="number"
                min={0}
                max={168}
                value={portalLead}
                onChange={(e) => setPortalLead(Number(e.target.value))}
              />
            </Field>
            <Field label={t("planningSettings.fields.portalHorizonDays")}>
              <Input
                type="number"
                min={1}
                max={60}
                value={portalHorizon}
                onChange={(e) => setPortalHorizon(Number(e.target.value))}
              />
            </Field>
          </div>
          <CheckboxRow
            label={t("planningSettings.fields.portalRequiresApproval")}
            checked={portalApproval}
            onChange={(e) => setPortalApproval(e.target.checked)}
          />
          <CheckboxRow
            label={t("planningSettings.fields.autoAssignBay")}
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
          />
        </div>
      </Card>

      <div>
        <Button type="submit" loading={update.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

function BlocksCard({ siteId }: { siteId: string }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const now = new Date();
  const blocks = trpc.resourceBlock.list.useQuery({ siteId, from: now });
  const list = trpc.appointment.list.useQuery({
    siteId,
    from: now,
    to: new Date(now.getTime() + 1),
  });
  const tz = list.data?.timeZone ?? "Africa/Abidjan";
  const [target, setTarget] = useState<string>("site");
  const [fromDay, setFromDay] = useState("");
  const [fromTime, setFromTime] = useState("08:00");
  const [toDay, setToDay] = useState("");
  const [toTime, setToTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [conflictIds, setConflictIds] = useState<string[] | null>(null);

  const create = trpc.resourceBlock.create.useMutation({
    onSuccess() {
      utils.resourceBlock.invalidate();
      utils.appointment.invalidate();
      utils.planning.invalidate();
      setConflictIds(null);
      setReason("");
      toast.push("ok", t("planningSettings.saved"));
    },
    onError(err) {
      const domain = domainCodeOf(err);
      if (domain?.code === "BLOCK_HAS_APPOINTMENTS") {
        setConflictIds((domain.details?.ids as string[]) ?? []);
      } else {
        toast.push("err", err.message);
      }
    },
  });
  const remove = trpc.resourceBlock.delete.useMutation({
    onSuccess: () => {
      utils.resourceBlock.invalidate();
      utils.appointment.invalidate();
    },
    onError: (err) => toast.push("err", err.message),
  });

  function submit(force: boolean) {
    if (!fromDay || !toDay || !reason.trim()) return;
    const [kind, id] = target.split(":");
    create.mutate({
      siteId,
      bayId: kind === "bay" ? id : null,
      membershipId: kind === "mechanic" ? id : null,
      startsAt: instantAt(fromDay, fromTime, tz),
      endsAt: instantAt(toDay, toTime, tz),
      reason: reason.trim(),
      force,
    });
  }

  return (
    <Card title={t("planningSettings.sections.blocks")} className="stack">
      <div className="grid-2">
        <Field label={t("planningSettings.blocks.target")}>
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="site">{t("planningSettings.blocks.site")}</option>
            {list.data?.bays.map((bay) => (
              <option key={bay.id} value={`bay:${bay.id}`}>
                {t("planningSettings.blocks.bay")} — {bay.name}
              </option>
            ))}
            {list.data?.mechanics.map((m) => (
              <option key={m.membershipId} value={`mechanic:${m.membershipId}`}>
                {t("planningSettings.blocks.mechanic")} — {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("planningSettings.blocks.reason")}>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t("planningSettings.blocks.from")}>
          <div className="pl-inline">
            <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
            <Input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          </div>
        </Field>
        <Field label={t("planningSettings.blocks.to")}>
          <div className="pl-inline">
            <Input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />
            <Input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
          </div>
        </Field>
      </div>
      {conflictIds ? (
        <div className="pl-hint-box">
          <span>
            {t("planningSettings.blocks.conflict")} ({conflictIds.length})
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => submit(true)}
            loading={create.isPending}
          >
            {t("planningSettings.blocks.forceUnassign")}
          </Button>
        </div>
      ) : null}
      <div>
        <Button
          type="button"
          onClick={() => submit(false)}
          loading={create.isPending}
          disabled={!fromDay || !toDay || !reason.trim()}
        >
          {t("planningSettings.blocks.add")}
        </Button>
      </div>
      <div className="section-label">{t("planningSettings.blocks.upcoming")}</div>
      {blocks.data?.length === 0 ? (
        <p className="hint">{t("planningSettings.blocks.empty")}</p>
      ) : null}
      {blocks.data?.map((block) => (
        <div key={block.id} className="list-row">
          <div>
            <b>
              {block.bay
                ? `${t("planningSettings.blocks.bay")} ${block.bay.name}`
                : block.membership
                  ? block.membership.user.name
                  : t("planningSettings.blocks.site")}
            </b>{" "}
            — {block.reason}
            <p>
              {formatDateTime(block.startsAt, tz)} → {formatDateTime(block.endsAt, tz)}
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={() => remove.mutate({ id: block.id })}>
            {t("planningSettings.blocks.delete")}
          </Button>
        </div>
      ))}
    </Card>
  );
}
