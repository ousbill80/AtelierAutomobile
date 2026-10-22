"use client";

// US-M03-01 / US-M03-02 / US-M03-05 — formulaire de RDV moderne & intelligent
// (panneau latéral et /rendez-vous/nouveau) :
// client (recherche ou création rapide), véhicule avec PlateBadge, tuiles de type de prestation,
// calcul dynamique de durée, créneaux libres, pont, mécanicien, doléances et notification client.
import { useMemo, useState } from "react";
import {
  Car,
  Check,
  Clock,
  MessageSquare,
  Search,
  Sparkles,
  User,
  UserPlus,
  Wrench,
  X,
} from "lucide-react";
import {
  Button,
  CheckboxRow,
  Field,
  Input,
  Modal,
  PhoneInput,
  PlateBadge,
  Select,
  Textarea,
} from "@atelieros/ui";
import { addDaysToKey, DEFAULT_DURATIONS, localDateKey } from "@atelieros/core/planning";
import { trpc } from "@/trpc/react";
import {
  SOURCES,
  TYPE_COLORS,
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
  const [newCustomer, setNewCustomer] = useState({
    lastName: "",
    firstName: "",
    phone: "",
    plate: "",
    make: "",
    model: "",
  });

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

  const todayKey = useMemo(() => localDateKey(new Date(), timeZone), [timeZone]);
  const dayKey = date || todayKey;

  const day = useMemo(
    () => ({
      from: instantOf(dayKey, "00:00", timeZone),
      to: instantOf(addDaysToKey(dayKey, 1), "00:00", timeZone),
    }),
    [dayKey, timeZone],
  );
  const columns = trpc.appointment.list.useQuery({ siteId, from: day.from, to: day.to });

  const slots = trpc.planning.availableSlots.useQuery(
    { siteId, type, durationMinutes: duration, days: 14, limit: 12 },
    { enabled: showSlots },
  );
  const suggestion = trpc.planning.suggestSlot.useMutation();

  const createCustomer = trpc.customer.create.useMutation({
    onSuccess(result) {
      setCustomerId(result.customer.id);
      if (result.customer.vehicles && result.customer.vehicles.length > 0) {
        setVehicleId(result.customer.vehicles[0].id);
      }
      setQuickCreate(false);
      setNewCustomer({ lastName: "", firstName: "", phone: "", plate: "", make: "", model: "" });
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

  function onSelectType(selectedType: AppointmentType) {
    setType(selectedType);
    const recommended = settings.data?.appointments.durations[selectedType] ?? DEFAULT_DURATIONS[selectedType];
    setDuration(recommended);
  }

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
      className="flex flex-col gap-5 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
    >
      {/* ── SECTION 1 : CLIENT & VÉHICULE ── */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/30 p-3.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="flex items-center gap-1.5">
            <User className="size-3.5 text-accent" aria-hidden />
            {ta("form.sections.customer")}
          </span>
          {customerId && (
            <button
              type="button"
              className="text-xs font-medium text-accent hover:underline"
              onClick={() => {
                setCustomerId(null);
                setVehicleId(null);
              }}
            >
              {ta("form.change")}
            </button>
          )}
        </div>

        {customerId && customer.data ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground text-base" data-testid="selected-customer">
                {customer.data.displayName}
              </span>
              {customer.data.phone && (
                <span className="font-mono text-xs text-muted">
                  {customer.data.phone}
                </span>
              )}
            </div>

            {/* Véhicules du client */}
            <div className="mt-1 flex flex-col gap-1.5 border-t border-border pt-2">
              <span className="text-xs font-medium text-muted">{ta("form.vehicle")}</span>
              {vehicles.length === 0 ? (
                <p className="text-xs text-muted">{ta("form.noVehicle")}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {vehicles.map((v) => {
                    const active = (vehicleId === v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVehicleId(v.id)}
                        className={`flex items-center justify-between rounded-lg border p-2 text-left transition ${
                          active
                            ? "border-foreground bg-surface-2 font-medium"
                            : "border-border bg-surface hover:bg-surface-2/60 text-muted hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <PlateBadge plate={v.plate} />
                          <span className="text-xs font-medium">
                            {[v.make, v.model].filter(Boolean).join(" ")}
                          </span>
                        </div>
                        {active && <Check className="size-4 text-accent" />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setVehicleId("")}
                    className={`text-xs self-start text-muted hover:text-foreground underline pt-0.5 ${
                      vehicleId === "" ? "font-semibold text-foreground" : ""
                    }`}
                  >
                    {ta("form.noVehicle")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ta("form.customerSearch")}
                aria-label={ta("form.customerSearch")}
                className="pl-9 min-h-11"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            {search.data && search.data.items.length === 0 && (
              <p className="text-xs text-muted">{ta("form.customerNone")}</p>
            )}

            {search.data?.items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCustomerId(c.id)}
                className="flex min-h-11 items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left hover:bg-surface-2 transition"
              >
                <span className="font-medium text-foreground">{c.displayName}</span>
                <span className="font-mono text-xs text-muted">{c.phone ?? ""}</span>
              </button>
            ))}

            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline self-start pt-1"
              onClick={() => setQuickCreate(true)}
            >
              <UserPlus className="size-3.5" />
              {ta("form.quickCreate")}
            </button>
          </div>
        )}

        {inspectionSoon && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-status-warn/40 bg-status-warn/10 p-2.5 text-xs text-foreground">
            <span className="flex-1 font-medium">{ta("form.inspectionPrep")}</span>
            <button
              type="button"
              className="rounded-md bg-status-warn px-2 py-1 font-semibold text-white shadow-sm hover:opacity-90 transition shrink-0"
              onClick={() => {
                setDuration(duration + 30);
                setComplaint((c) => (c ? `${c}\n` : "") + ta("types.INSPECTION_PREP"));
              }}
            >
              + {ta("form.addInspectionPrep")}
            </button>
          </div>
        )}
      </section>

      {/* ── SECTION 2 : PRESTATION & DURÉE ── */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/30 p-3.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="flex items-center gap-1.5">
            <Wrench className="size-3.5 text-accent" aria-hidden />
            {ta("form.sections.service")}
          </span>
          <span className="text-[11px] font-normal text-muted lowercase">
            {duration} min
          </span>
        </div>

        {/* Grille de tuiles interactives par type */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TYPES.map((value) => {
            const isSelected = type === value;
            const dotColor = TYPE_COLORS[value];
            return (
              <button
                key={value}
                type="button"
                onClick={() => onSelectType(value)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition ${
                  isSelected
                    ? "border-foreground bg-surface shadow-sm font-semibold"
                    : "border-border bg-surface/80 hover:bg-surface text-muted hover:text-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor }}
                    aria-hidden
                  />
                  <span className="text-xs font-medium text-foreground truncate">
                    {ta(`types.${value}`)}
                  </span>
                </div>
                <span className="text-[11px] text-muted">
                  {settings.data?.appointments.durations[value] ?? DEFAULT_DURATIONS[value]} min
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted">{ta("form.duration")}</span>
          <div className="flex items-center gap-1 max-w-[140px]">
            <Input
              type="number"
              min={15}
              step={15}
              value={duration}
              onChange={(e) => setDuration(Math.max(15, Number(e.target.value) || 15))}
              className="text-center font-mono font-medium"
            />
            <span className="text-xs text-muted">min</span>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 : DATE & CRÉNEAU ── */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/30 p-3.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="flex items-center gap-1.5">
            <Clock className="size-3.5 text-accent" aria-hidden />
            {ta("form.sections.scheduling")}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setDate(todayKey)}
              className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                date === todayKey ? "bg-foreground text-background font-semibold" : "text-muted hover:text-foreground"
              }`}
            >
              {ta("form.quickDates.today")}
            </button>
            <button
              type="button"
              onClick={() => setDate(addDaysToKey(todayKey, 1))}
              className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                date === addDaysToKey(todayKey, 1) ? "bg-foreground text-background font-semibold" : "text-muted hover:text-foreground"
              }`}
            >
              {ta("form.quickDates.tomorrow")}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={ta("form.date")}>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-11 font-mono"
            />
          </Field>
          <Field label={ta("form.time")}>
            <Input
              type="time"
              step={900}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="min-h-11 font-mono font-semibold"
            />
          </Field>
        </div>

        {/* Bouton trouver un créneau */}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowSlots((v) => !v)}
          className="w-full text-xs"
        >
          <Clock className="size-3.5" aria-hidden />
          {ta("findSlot")}
        </Button>

        {showSlots && (
          <div
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
            data-testid="slot-finder"
          >
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
              {ta("form.slotsTitle")}
            </p>
            {slots.isLoading && <p className="text-xs text-muted">{ta("form.slotsLoading")}</p>}
            {slots.data && slots.data.groups.length === 0 && (
              <p className="text-xs text-muted">{ta("form.slotsEmpty")}</p>
            )}
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 pr-1">
              {slots.data?.groups.flatMap((g) =>
                g.slots.map((s) => (
                  <button
                    key={`${String(s.startsAt)}-${s.bayId}`}
                    type="button"
                    onClick={() => pickSlot(s.startsAt, s.bayId)}
                    className="flex min-h-9 items-center justify-between rounded-md border border-border bg-surface px-2.5 py-1 text-xs hover:bg-surface-2 transition text-left"
                  >
                    <span className="font-semibold text-foreground">
                      {fmtDay(s.startsAt, timeZone)} · {fmtTime(s.startsAt, timeZone)}
                    </span>
                    <span className="text-[11px] text-muted">{s.bayName ?? ta("unassigned")}</span>
                  </button>
                )),
              )}
            </div>
          </div>
        )}

        {/* Assistant de créneau IA */}
        {customerId && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Sparkles size={13} className="text-accent" aria-hidden /> {ta("form.suggestTitle")}
            </p>
            <div className="flex gap-2">
              <Input
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={ta("form.suggestPlaceholder")}
                aria-label={ta("form.suggestPlaceholder")}
                className="text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                className="text-xs shrink-0"
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
            {suggestion.data?.suggestions.map((s) => (
              <button
                key={String(s.startsAt)}
                type="button"
                onClick={() => pickSlot(s.startsAt, s.bayId)}
                className="flex min-h-10 flex-col items-start justify-center rounded-md border border-border bg-surface px-3 py-1 text-left text-xs hover:bg-surface-2 transition"
              >
                <span className="font-semibold text-foreground">{s.label}</span>
                <span className="text-[11px] text-muted">{s.reason}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── SECTION 4 : AFFECTATION ATELIER & SOURCE ── */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/30 p-3.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="flex items-center gap-1.5">
            <Car className="size-3.5 text-accent" aria-hidden />
            {ta("form.sections.workshop")}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
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
      </section>

      {/* ── SECTION 5 : MOTIF & NOTIFICATION ── */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2/30 p-3.5">
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="size-3.5 text-accent" aria-hidden />
            {ta("form.sections.details")}
          </span>
        </div>

        <Field label={ta("form.complaint")} hint={ta("form.complaintHint")}>
          <Textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={2}
            placeholder="Doléances exprimées par le client, bruits suspects, voyants allumés…"
          />
        </Field>

        <Field label={ta("form.notes")}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Informations internes pour l'équipe atelier…"
          />
        </Field>

        <div className="rounded-lg border border-border bg-surface p-2.5">
          <CheckboxRow
            label={
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <MessageSquare className="size-3.5 text-status-ok" />
                {ta("form.notify")}
              </span>
            }
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <p className="text-[11px] text-muted pl-6">
            {ta("form.clientNotificationHint")}
          </p>
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-status-bad bg-status-bad-bg p-3 text-xs font-semibold text-status-bad"
        >
          {error}
        </p>
      )}

      {/* Boutons d'action */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
        <Button
          type="submit"
          loading={create.isPending}
          className="flex-1 min-h-11 shadow-sm font-semibold"
        >
          {create.isPending
            ? ta("form.saving")
            : notify
            ? ta("form.saveAndNotify")
            : ta("form.save")}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="min-h-11 text-muted hover:text-foreground"
          >
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
            required
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
