"use client";

// US-M03-01 / US-M03-02 / US-M03-05 — formulaire de RDV (panneau latéral et /rendez-vous/nouveau) :
// client (recherche ou création rapide), véhicule, type et durée proposée, pont, mécanicien,
// motif, source ; assistant « Trouver un créneau » et suggestion à partir d'une intention.
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Button,
  CheckboxRow,
  Field,
  Input,
  Modal,
  PhoneInput,
  Select,
  Textarea,
} from "@atelieros/ui";
import { addDaysToKey, DEFAULT_DURATIONS } from "@atelieros/core/planning";
import { trpc } from "@/trpc/react";
import {
  SOURCES,
  TYPES,
  dayKeyOf,
  errorInfo,
  fmtDay,
  fmtTime,
  instantOf,
  ta,
  type AppointmentSource,
  type AppointmentType,
} from "./labels";

export interface AppointmentFormInitial {
  startsAt?: Date;
  bayId?: string | null;
  mechanicId?: string | null;
  source?: AppointmentSource;
  customerId?: string;
  vehicleId?: string | null;
  type?: AppointmentType;
  reminderId?: string | null;
}

export function AppointmentForm({
  initial,
  siteId,
  timeZone,
  onDone,
  onCancel,
}: {
  initial: AppointmentFormInitial;
  siteId?: string;
  timeZone: string;
  onDone: (result: { id: string; notified: boolean; warnings: string[] }) => void;
  onCancel?: () => void;
}) {
  const utils = trpc.useUtils();
  const initialStart = initial.startsAt ?? null;
  const [customerId, setCustomerId] = useState<string | null>(initial.customerId ?? null);
  const [query, setQuery] = useState("");
  // `null` = choix automatique (le seul véhicule du client, s'il n'en a qu'un).
  const [vehicleChoice, setVehicleId] = useState<string | null>(initial.vehicleId ?? null);
  const [type, setType] = useState<AppointmentType>(initial.type ?? "SERVICE");
  const [date, setDate] = useState<string>(initialStart ? dayKeyOf(initialStart, timeZone) : "");
  const [time, setTime] = useState<string>(initialStart ? fmtTime(initialStart, timeZone) : "");
  // `null` = durée proposée selon le type (paramètres §6), tant que l'utilisateur ne l'a pas saisie.
  const [durationChoice, setDuration] = useState<number | null>(null);
  const [now] = useState(() => Date.now());
  const [bayId, setBayId] = useState<string>(initial.bayId ?? "");
  const [mechanicId, setMechanicId] = useState<string>(initial.mechanicId ?? "");
  const [complaint, setComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<AppointmentSource>(initial.source ?? "STAFF");
  const [notify, setNotify] = useState(true);
  const [showSlots, setShowSlots] = useState(false);
  const [intent, setIntent] = useState("");
  const [force, setForce] = useState<{ message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickCreate, setQuickCreate] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ lastName: "", firstName: "", phone: "" });

  const settings = trpc.planningSettings.get.useQuery();
  const duration =
    durationChoice ?? settings.data?.appointments.durations[type] ?? DEFAULT_DURATIONS[type];

  const search = trpc.customer.list.useQuery(
    { q: query.trim(), limit: 8 },
    { enabled: !customerId && query.trim().length >= 2 },
  );
  const customer = trpc.customer.get.useQuery({ id: customerId ?? "" }, { enabled: !!customerId });
  const vehicles = customer.data?.vehicles ?? [];
  const vehicleId = vehicleChoice ?? (vehicles.length === 1 ? vehicles[0]!.id : "");

  const dayKey = date || dayKeyOf(new Date(), timeZone);
  const day = useMemo(
    () => ({
      from: instantOf(dayKey, "00:00", timeZone),
      to: instantOf(addDaysToKey(dayKey, 1), "00:00", timeZone),
    }),
    [dayKey, timeZone],
  );
  const columns = trpc.appointment.list.useQuery({ siteId, from: day.from, to: day.to });

  const slots = trpc.planning.availableSlots.useQuery(
    { siteId, type, durationMinutes: duration, days: 14, limit: 10 },
    { enabled: showSlots },
  );
  const suggestion = trpc.planning.suggestSlot.useQuery(
    { customerId: customerId ?? "", vehicleId: vehicleId || null, type, preferredText: intent },
    { enabled: false },
  );

  const createCustomer = trpc.customer.create.useMutation({
    onSuccess(result) {
      setCustomerId(result.customer.id);
      setQuickCreate(false);
    },
    onError(e) {
      setError(e.message);
    },
  });

  const create = trpc.appointment.create.useMutation({
    onSuccess(result) {
      utils.appointment.invalidate();
      utils.planning.invalidate();
      onDone({ id: result.appointment.id, notified: result.notified, warnings: result.warnings });
    },
    onError(e) {
      const info = errorInfo(e);
      if (info?.forcible) {
        setForce({ message: info.message });
      } else {
        setError(info?.message ?? ta("errors.generic"));
      }
    },
  });

  const vehicle = customer.data?.vehicles.find((v) => v.id === vehicleId);
  const inspectionSoon =
    !!vehicle &&
    type !== "INSPECTION_PREP" &&
    ((vehicle.inspectionExpiryDate &&
      new Date(vehicle.inspectionExpiryDate).getTime() - now < 30 * 86_400_000) ||
      (vehicle.nextServiceDueDate &&
        new Date(vehicle.nextServiceDueDate).getTime() < now + 30 * 86_400_000));

  function submit(withForce = false) {
    setError(null);
    if (!customerId) {
      setError(ta("form.required"));
      return;
    }
    if (!date || !time) {
      setError(ta("findSlot"));
      return;
    }
    create.mutate({
      siteId,
      customerId,
      vehicleId: vehicleId || null,
      type,
      startsAt: instantOf(date, time, timeZone),
      durationMinutes: duration,
      bayId: bayId || null,
      mechanicId: mechanicId || null,
      complaint: complaint || undefined,
      notes: notes || undefined,
      source,
      reminderId: initial.reminderId ?? null,
      notifyCustomer: notify,
      force: withForce,
    });
  }

  function pickSlot(startsAt: Date | string, slotBayId: string | null) {
    const value = new Date(startsAt);
    setDate(dayKeyOf(value, timeZone));
    setTime(fmtTime(value, timeZone));
    if (slotBayId) setBayId(slotBayId);
    setShowSlots(false);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      <Field label={ta("form.customer")}>
        {customerId && customer.data ? (
          <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3">
            <span className="truncate font-medium" data-testid="selected-customer">
              {customer.data.displayName}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCustomerId(null);
                setVehicleId(null);
              }}
            >
              {ta("form.change")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={ta("form.customerSearch")}
              aria-label={ta("form.customerSearch")}
              className="min-h-11"
            />
            {search.data && search.data.items.length === 0 && (
              <p className="text-sm text-muted">{ta("form.customerNone")}</p>
            )}
            {search.data?.items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCustomerId(c.id)}
                className="flex min-h-11 items-center justify-between rounded-md border border-border px-3 text-left hover:bg-surface-2"
              >
                <span className="truncate">{c.displayName}</span>
                <span className="text-xs text-muted">{c.phone ?? ""}</span>
              </button>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm self-start"
              onClick={() => setQuickCreate(true)}
            >
              {ta("form.quickCreate")}
            </button>
          </div>
        )}
      </Field>

      {customerId && (
        <Field label={ta("form.vehicle")}>
          <Select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            className="min-h-11"
          >
            <option value="">{ta("form.noVehicle")}</option>
            {customer.data?.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {[v.make, v.model].filter(Boolean).join(" ")} — {v.plate}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {inspectionSoon && (
        <div className="alert-banner warn flex-wrap">
          <span>{ta("form.inspectionPrep")}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setDuration(duration + 30);
              setComplaint((c) => (c ? `${c}\n` : "") + ta("types.INSPECTION_PREP"));
            }}
          >
            {ta("form.addInspectionPrep")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={ta("form.type")}>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as AppointmentType)}
            className="min-h-11"
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {ta(`types.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Input
          label={ta("form.duration")}
          type="number"
          min={15}
          step={15}
          value={duration}
          onChange={(e) => {
            setDuration(Number(e.target.value));
          }}
          className="min-h-11"
        />
        <Input
          label={ta("form.date")}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="min-h-11"
        />
        <Input
          label={ta("form.time")}
          type="time"
          step={900}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="min-h-11"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowSlots((v) => !v)}
          className="min-h-11"
        >
          {ta("findSlot")}
        </Button>
      </div>
      {showSlots && (
        <div
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          data-testid="slot-finder"
        >
          <p className="text-sm font-semibold">{ta("form.slotsTitle")}</p>
          {slots.isLoading && <p className="text-sm text-muted">{ta("form.slotsLoading")}</p>}
          {slots.data && slots.data.groups.length === 0 && (
            <p className="text-sm text-muted">{ta("form.slotsEmpty")}</p>
          )}
          {slots.data?.groups.flatMap((g) =>
            g.slots.map((s) => (
              <button
                key={`${String(s.startsAt)}-${s.bayId}`}
                type="button"
                onClick={() => pickSlot(s.startsAt, s.bayId)}
                className="flex min-h-11 items-center justify-between rounded-md border border-border px-3 text-left text-sm hover:bg-surface-2"
              >
                <span>
                  {fmtDay(s.startsAt, timeZone)} · {fmtTime(s.startsAt, timeZone)}
                </span>
                <span className="text-muted">{s.bayName ?? ta("unassigned")}</span>
              </button>
            )),
          )}
        </div>
      )}

      {customerId && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles size={14} aria-hidden /> {ta("form.suggestTitle")}
          </p>
          <div className="flex gap-2">
            <Input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder={ta("form.suggestPlaceholder")}
              aria-label={ta("form.suggestPlaceholder")}
              className="min-h-11"
            />
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              onClick={() => suggestion.refetch()}
            >
              {ta("form.suggest")}
            </Button>
          </div>
          {suggestion.data?.suggestions.map((s) => (
            <button
              key={String(s.startsAt)}
              type="button"
              onClick={() => pickSlot(s.startsAt, s.bayId)}
              className="flex min-h-11 flex-col items-start justify-center rounded-md border border-border px-3 text-left text-sm hover:bg-surface-2"
            >
              <span className="font-medium">{s.label}</span>
              <span className="text-xs text-muted">{s.reason}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={ta("form.bay")}>
          <Select value={bayId} onChange={(e) => setBayId(e.target.value)} className="min-h-11">
            <option value="">{ta("form.noBay")}</option>
            {columns.data?.bays.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={ta("form.mechanic")}>
          <Select
            value={mechanicId}
            onChange={(e) => setMechanicId(e.target.value)}
            className="min-h-11"
          >
            <option value="">{ta("form.noMechanic")}</option>
            {columns.data?.mechanics.map((m) => (
              <option key={m.id} value={m.id} disabled={m.absent}>
                {m.name}
                {m.absent ? ` (${ta("mechanicAbsent")})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={ta("form.source")}>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as AppointmentSource)}
            className="min-h-11"
          >
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {ta(`sources.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label={ta("form.complaint")} hint={ta("form.complaintHint")}>
        <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={2} />
      </Field>
      <Field label={ta("form.notes")}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </Field>
      <CheckboxRow
        label={ta("form.notify")}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={create.isPending} className="min-h-11">
          {create.isPending
            ? ta("form.saving")
            : notify
              ? ta("form.saveAndNotify")
              : ta("form.save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} className="min-h-11">
            {ta("form.cancel")}
          </Button>
        )}
      </div>

      <Modal
        open={!!force}
        title={ta("form.forceTitle")}
        onClose={() => setForce(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setForce(null)}>
              {ta("form.cancel")}
            </Button>
            <Button
              onClick={() => {
                setForce(null);
                submit(true);
              }}
            >
              {ta("form.forceConfirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{force?.message}</p>
      </Modal>

      <Modal
        open={quickCreate}
        title={ta("form.quickCreateTitle")}
        onClose={() => setQuickCreate(false)}
        footer={
          <Button
            loading={createCustomer.isPending}
            onClick={() =>
              createCustomer.mutate({
                type: "INDIVIDUAL",
                lastName: newCustomer.lastName,
                firstName: newCustomer.firstName || undefined,
                phone: newCustomer.phone || undefined,
                source: "comptoir",
              })
            }
          >
            {ta("form.quickCreate")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={ta("form.lastName")}
            value={newCustomer.lastName}
            onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
          />
          <Input
            label={ta("form.firstName")}
            value={newCustomer.firstName}
            onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
          />
          <Field label={ta("form.phone")}>
            <PhoneInput
              value={newCustomer.phone}
              onChange={(phone) => setNewCustomer({ ...newCustomer, phone })}
            />
          </Field>
        </div>
      </Modal>
    </form>
  );
}
