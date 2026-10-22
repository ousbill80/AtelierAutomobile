"use client";

// US-M03-01 / US-M03-02 / US-M03-05 — formulaire de RDV (panneau latéral et /rendez-vous/nouveau) :
// client (recherche ou création rapide), véhicule, type et durée proposée, pont, mécanicien,
// motif, source ; assistant « Trouver un créneau » et suggestion à partir d'une intention.
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Button,
  CheckboxRow,
  CustomerForm,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  type CustomerFormData,
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
  const [notifyChannel, setNotifyChannel] = useState<"AUTO" | "WHATSAPP" | "SMS" | "EMAIL">("AUTO");
  const [showSlots, setShowSlots] = useState(false);
  const [intent, setIntent] = useState("");
  const [force, setForce] = useState<{ message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickCreate, setQuickCreate] = useState(false);
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState("");

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
  const suggestion = trpc.planning.suggestSlot.useMutation();

  const createCustomer = trpc.customer.create.useMutation({
    onSuccess(result) {
      // On sélectionne le client créé et on ferme le modal de création
      setCustomerId(result.customer.id);
      setQuickCreate(false);
      setCreateCustomerError(null);
      setDuplicateOverrideReason("");
    },
    onError(e) {
      setCreateCustomerError(e.message);
    },
  });

  function handleCreateCustomer(data: CustomerFormData) {
    setCreateCustomerError(null);
    if (data.type === "INDIVIDUAL") {
      createCustomer.mutate({
        type: "INDIVIDUAL",
        civility: data.civility,
        lastName: data.lastName,
        firstName: data.firstName,
        phone: data.phone,
        email: data.email,
        commune: data.commune,
        address: data.address,
        vehicle: data.vehicle,
        source: "comptoir",
        duplicateOverrideReason: duplicateOverrideReason || undefined,
      });
    } else {
      createCustomer.mutate({
        type: "COMPANY",
        companyName: data.companyName!,
        ncc: data.ncc,
        rccm: data.rccm,
        phone: data.phone,
        email: data.email,
        commune: data.commune,
        address: data.address,
        vehicle: data.vehicle,
        source: "comptoir",
        duplicateOverrideReason: duplicateOverrideReason || undefined,
      });
    }
  }

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
      preferredChannel: notifyChannel,
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
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      {/* Section Client */}
      <div className="panel-form-section">
        <Field label={ta("form.customer")}>
          {customerId && customer.data ? (
            <div className="panel-customer-selected">
              <span className="panel-customer-selected-name" data-testid="selected-customer">
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
            <div>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ta("form.customerSearch")}
                aria-label={ta("form.customerSearch")}
              />
              {search.data && search.data.items.length === 0 && (
                <p className="text-sm text-muted" style={{ marginTop: 8 }}>{ta("form.customerNone")}</p>
              )}
              <div className="panel-customer-results">
                {search.data?.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCustomerId(c.id)}
                    className="panel-customer-item"
                  >
                    <span className="panel-customer-item-name">{c.displayName}</span>
                    <span className="panel-customer-item-phone">{c.phone ?? ""}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                onClick={() => setQuickCreate(true)}
              >
                {ta("form.quickCreate")}
              </button>
            </div>
          )}
        </Field>
      </div>

      {/* Section Type & Horaire */}
      <div className="panel-form-section">
        <div className="panel-form-row">
          <Field label={ta("form.type")}>
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as AppointmentType)}
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
          />
        </div>
        <div className="panel-form-row">
          <Input
            label={ta("form.date")}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input
            label={ta("form.time")}
            type="time"
            step={900}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowSlots((v) => !v)}
        >
          {ta("findSlot")}
        </Button>
      </div>

      {showSlots && (
        <div className="panel-slots" data-testid="slot-finder">
          <div className="panel-slots-title">{ta("form.slotsTitle")}</div>
          {slots.isLoading && <p className="text-sm text-muted">{ta("form.slotsLoading")}</p>}
          {slots.data && slots.data.groups.length === 0 && (
            <p className="text-sm text-muted">{ta("form.slotsEmpty")}</p>
          )}
          <div className="panel-slots-list">
            {slots.data?.groups.flatMap((g) =>
              g.slots.map((s) => (
                <button
                  key={`${String(s.startsAt)}-${s.bayId}`}
                  type="button"
                  onClick={() => pickSlot(s.startsAt, s.bayId)}
                  className="panel-slot-item"
                >
                  <span className="panel-slot-time">
                    {fmtDay(s.startsAt, timeZone)} · {fmtTime(s.startsAt, timeZone)}
                  </span>
                  <span className="panel-slot-bay">{s.bayName ?? ta("unassigned")}</span>
                </button>
              )),
            )}
          </div>
        </div>
      )}

      {/* Section Affectation */}
      <div className="panel-form-section">
        <div className="panel-form-row">
          <Field label={ta("form.bay")}>
            <Select value={bayId} onChange={(e) => setBayId(e.target.value)}>
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
        </div>
        <Field label={ta("form.source")}>
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as AppointmentSource)}
          >
            {SOURCES.map((value) => (
              <option key={value} value={value}>
                {ta(`sources.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {customerId && (
        <Field label={ta("form.vehicle")}>
          <Select
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
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

      {customerId && (
        <div className="panel-suggest">
          <div className="panel-suggest-title">
            <Sparkles size={14} aria-hidden /> {ta("form.suggestTitle")}
          </div>
          <div className="panel-suggest-input">
            <Input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder={ta("form.suggestPlaceholder")}
              aria-label={ta("form.suggestPlaceholder")}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                customerId &&
                suggestion.mutate({
                  customerId,
                  vehicleId: vehicleId || null,
                  type,
                  preferredText: intent,
                })
              }
            >
              {ta("form.suggest")}
            </Button>
          </div>
          {suggestion.data?.suggestions && suggestion.data.suggestions.length > 0 && (
            <div className="panel-suggest-results">
              {suggestion.data.suggestions.map((s) => (
                <button
                  key={String(s.startsAt)}
                  type="button"
                  onClick={() => pickSlot(s.startsAt, s.bayId)}
                  className="panel-suggest-item"
                >
                  <span className="panel-suggest-item-label">{s.label}</span>
                  <span className="panel-suggest-item-reason">{s.reason}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Section Notes */}
      <div className="panel-form-section">
        <Field label={ta("form.complaint")} hint={ta("form.complaintHint")}>
          <Textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} rows={2} />
        </Field>
        <Field label={ta("form.notes")}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </div>

      <CheckboxRow
        label={ta("form.notify")}
        checked={notify}
        onChange={(e) => setNotify(e.target.checked)}
      />

      {notify && (
        <Field label={ta("form.notifyChannel")}>
          <Select
            value={notifyChannel}
            onChange={(e) =>
              setNotifyChannel(e.target.value as "AUTO" | "WHATSAPP" | "SMS" | "EMAIL")
            }
          >
            <option value="AUTO">{ta("channels.AUTO")}</option>
            <option value="WHATSAPP">{ta("channels.WHATSAPP")}</option>
            <option value="SMS">{ta("channels.SMS")}</option>
            <option value="EMAIL">{ta("channels.EMAIL")}</option>
          </Select>
        </Field>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
        >
          {error}
        </p>
      )}

      <div className="panel-form-actions">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ta("form.cancel")}
          </Button>
        )}
        <Button type="submit" loading={create.isPending}>
          {create.isPending
            ? ta("form.saving")
            : notify
              ? ta("form.saveAndNotify")
              : ta("form.save")}
        </Button>
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
        onClose={() => {
          setQuickCreate(false);
          setCreateCustomerError(null);
          setDuplicateOverrideReason("");
        }}
        size="lg"
      >
        <CustomerForm
          onSubmit={handleCreateCustomer}
          isPending={createCustomer.isPending}
          error={createCustomerError}
          showDuplicateOverride={!!createCustomerError?.includes("doublon")}
          duplicateOverrideReason={duplicateOverrideReason}
          onDuplicateOverrideChange={setDuplicateOverrideReason}
          compact
          onCancel={() => {
            setQuickCreate(false);
            setCreateCustomerError(null);
            setDuplicateOverrideReason("");
          }}
        />
      </Modal>
    </form>
  );
}
