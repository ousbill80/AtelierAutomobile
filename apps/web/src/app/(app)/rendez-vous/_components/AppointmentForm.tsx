"use client";

import { useMemo, useState } from "react";
import { Button, CheckboxRow, Field, Input, Select, Textarea } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import {
  APPOINTMENT_SOURCES,
  APPOINTMENT_TYPES,
  sourceLabel,
  typeLabel,
  type AppointmentTypeKey,
} from "../_lib/labels";
import { civilDay, formatTime, instantAt, toMinutes, toTime } from "../_lib/time";
import { domainCodeOf, useToast } from "../_lib/useToast";
import type { PlanningBay, PlanningMechanic } from "../_lib/types";
import { FindSlotDialog } from "./FindSlotDialog";

export interface AppointmentFormProps {
  siteId: string;
  timeZone: string;
  durations: Record<string, number>;
  bays: PlanningBay[];
  mechanics: PlanningMechanic[];
  canForce: boolean;
  initial?: {
    startsAt?: Date;
    bayId?: string | null;
    source?: string;
    customerId?: string;
    vehicleId?: string;
  };
  onCreated: (appointmentId: string) => void;
  onCancel?: () => void;
}

interface CustomerOption {
  id: string;
  displayName: string;
  phone: string | null;
}

/** Panneau / page de création d'un RDV (US-M03-01, US-M03-02). */
export function AppointmentForm(props: AppointmentFormProps) {
  const { timeZone: tz } = props;
  const toast = useToast();
  const utils = trpc.useUtils();

  const [query, setQuery] = useState("");
  const [customerState, setCustomer] = useState<CustomerOption | null | undefined>(undefined);
  const [vehicleId, setVehicleId] = useState<string>(props.initial?.vehicleId ?? "");
  const [type, setType] = useState<AppointmentTypeKey>("SERVICE");
  const [day, setDay] = useState(civilDay(props.initial?.startsAt ?? new Date(), tz));
  const [time, setTime] = useState(
    props.initial?.startsAt ? formatTime(props.initial.startsAt, tz) : "09:00",
  );
  const [manualDuration, setManualDuration] = useState<number | null>(null);
  const [bayId, setBayId] = useState<string>(props.initial?.bayId ?? "");
  const [mechanicId, setMechanicId] = useState("");
  const [source, setSource] = useState(props.initial?.source ?? "STAFF");
  const [complaint, setComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slotOpen, setSlotOpen] = useState(false);
  const [addPreInspection, setAddPreInspection] = useState(false);

  const customerDetail = trpc.customer.get.useQuery(
    { id: customerState?.id ?? props.initial?.customerId ?? "" },
    { enabled: Boolean(customerState?.id ?? props.initial?.customerId) },
  );
  // Client pré-rempli (lien depuis une fiche client) : dérivé de la requête tant que l'utilisateur n'a rien choisi.
  const customer: CustomerOption | null =
    customerState !== undefined
      ? customerState
      : props.initial?.customerId && customerDetail.data
        ? {
            id: customerDetail.data.id,
            displayName: customerDetail.data.displayName,
            phone: customerDetail.data.phone,
          }
        : null;
  const search = trpc.customer.list.useQuery(
    { q: query, limit: 8 },
    { enabled: query.trim().length >= 2 && !customer },
  );
  // RG-M03-04 : durée proposée selon le type (+30 min si pré-visite ajoutée), sauf saisie manuelle.
  const duration = manualDuration ?? (props.durations[type] ?? 60) + (addPreInspection ? 30 : 0);

  const vehicles = customerDetail.data?.vehicles ?? [];
  const selectedVehicle = vehicles.find((v) => v.id === vehicleId);
  const suggestPreInspection =
    selectedVehicle &&
    type !== "INSPECTION_PREP" &&
    (selectedVehicle.inspectionStatus === "DUE_SOON" ||
      selectedVehicle.inspectionStatus === "EXPIRED");
  const suggestService =
    selectedVehicle &&
    type !== "SERVICE" &&
    (selectedVehicle.serviceStatus === "DUE_SOON" || selectedVehicle.serviceStatus === "OVERDUE");

  const create = trpc.appointment.create.useMutation({
    onSuccess(result) {
      utils.appointment.invalidate();
      utils.planning.invalidate();
      toast.push(
        "ok",
        result.messageId || !notify
          ? t("appointments.toasts.created")
          : t("appointments.toasts.createdNoChannel"),
      );
      for (const warning of result.warnings) toast.push("err", warning);
      props.onCreated(result.appointment.id);
    },
    onError(err) {
      const domain = domainCodeOf(err);
      setError(err.message);
      if (
        domain?.code === "SLOT_CONFLICT" ||
        domain?.code === "CAPACITY_EXCEEDED" ||
        domain?.code === "OUTSIDE_OPENING_HOURS" ||
        domain?.code === "DUPLICATE_SAME_DAY"
      ) {
        toast.push("err", t("appointments.toasts.conflict", { message: err.message }));
      }
    },
  });

  const compatibleBays = useMemo(() => props.bays, [props.bays]);

  function submit(withNotify: boolean) {
    if (!customer) return;
    setError(null);
    create.mutate({
      siteId: props.siteId,
      customerId: customer.id,
      vehicleId: vehicleId || null,
      type,
      startsAt: instantAt(day, time, tz),
      durationMinutes: duration,
      bayId: bayId || null,
      mechanicId: mechanicId || null,
      complaint: complaint.trim()
        ? complaint.trim() + (addPreInspection ? " + pré-visite technique" : "")
        : addPreInspection
          ? "Pré-visite technique"
          : null,
      laborOperationIds: [],
      source: source as "STAFF" | "PHONE" | "WHATSAPP" | "PORTAL" | "REMINDER",
      notes: notes.trim() || null,
      notifyCustomer: withNotify,
      force,
    });
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        submit(notify);
      }}
    >
      <Field label={t("appointments.fields.customer")}>
        {customer ? (
          <div className="pl-selected">
            <span>
              <b>{customer.displayName}</b>{" "}
              {customer.phone ? <small className="num"> · {customer.phone}</small> : null}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCustomer(null);
                setVehicleId("");
                setQuery("");
              }}
            >
              {t("common.edit")}
            </Button>
          </div>
        ) : (
          <div className="pl-search">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("appointments.fields.searchCustomer")}
              autoFocus
            />
            {query.trim().length >= 2 && search.data ? (
              <div className="results" role="listbox">
                {search.data.items.length === 0 ? (
                  <button type="button" disabled>
                    {t("common.genericError")}
                  </button>
                ) : null}
                {search.data.items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setCustomer({
                        id: item.id,
                        displayName: item.displayName,
                        phone: item.phone,
                      });
                      setQuery("");
                    }}
                  >
                    {item.displayName}
                    <small className="num">{item.phone ?? "—"}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Field>

      <Field label={t("appointments.fields.vehicle")}>
        <Select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          disabled={!customer}
        >
          <option value="">{t("appointments.fields.withoutVehicle")}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.make} {v.model} — {v.plate}
            </option>
          ))}
        </Select>
      </Field>

      {suggestPreInspection ? (
        <div className="pl-hint-box">
          <span>{t("appointments.suggestion.vtSoon")}</span>
          <CheckboxRow
            label={t("appointments.suggestion.prefill")}
            checked={addPreInspection}
            onChange={(e) => setAddPreInspection(e.target.checked)}
          />
        </div>
      ) : null}
      {suggestService ? (
        <div className="pl-hint-box">
          <span>{t("appointments.suggestion.serviceDue")}</span>
        </div>
      ) : null}

      <div className="pl-inline">
        <Field label={t("appointments.fields.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as AppointmentTypeKey)}>
            {APPOINTMENT_TYPES.map((key) => (
              <option key={key} value={key}>
                {typeLabel(key)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("appointments.fields.source")}>
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            {APPOINTMENT_SOURCES.filter((s) => s !== "PORTAL").map((key) => (
              <option key={key} value={key}>
                {sourceLabel(key)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="pl-inline">
        <Field label={t("appointments.fields.date")}>
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </Field>
        <Field label={t("appointments.fields.time")}>
          <Input
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(toTime(Math.round(toMinutes(e.target.value) / 5) * 5))}
            required
          />
        </Field>
      </div>
      <div className="pl-inline">
        <Field label={t("appointments.fields.duration")}>
          <Input
            type="number"
            min={15}
            step={15}
            value={duration}
            onChange={(e) => setManualDuration(Number(e.target.value))}
          />
        </Field>
        <Field label={t("appointments.fields.bay")}>
          <Select value={bayId} onChange={(e) => setBayId(e.target.value)}>
            <option value="">{t("appointments.fields.unassignedBay")}</option>
            {compatibleBays.map((bay) => (
              <option key={bay.id} value={bay.id}>
                {bay.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t("appointments.fields.mechanic")}>
        <Select value={mechanicId} onChange={(e) => setMechanicId(e.target.value)}>
          <option value="">{t("appointments.fields.noMechanic")}</option>
          {props.mechanics.map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="button" variant="secondary" onClick={() => setSlotOpen(true)}>
        {t("appointments.actions.findSlot")}
      </Button>
      <Field label={t("appointments.fields.complaint")}>
        <Textarea rows={2} value={complaint} onChange={(e) => setComplaint(e.target.value)} />
      </Field>
      <Field label={`${t("appointments.fields.notes")} ${t("common.optional")}`}>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
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
        <div className="pl-error-box" role="alert">
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="submit" disabled={!customer} loading={create.isPending}>
          {notify ? t("appointments.actions.saveAndNotify") : t("appointments.actions.save")}
        </Button>
        {props.onCancel ? (
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>

      <FindSlotDialog
        open={slotOpen}
        onClose={() => setSlotOpen(false)}
        siteId={props.siteId}
        timeZone={tz}
        type={type}
        durationMinutes={duration}
        fromDay={day}
        onPick={(slot) => {
          setDay(civilDay(slot.startsAt, tz));
          setTime(formatTime(slot.startsAt, tz));
          if (slot.bayId) setBayId(slot.bayId);
          setSlotOpen(false);
        }}
      />
    </form>
  );
}
