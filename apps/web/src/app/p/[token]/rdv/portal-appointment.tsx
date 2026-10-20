"use client";

// Portail client M03 : mobile d'abord, cibles ≥ 44 px. Jamais de nom d'autre client : seules
// des heures libres sont proposées (6 au plus par demi-journée, RG-M03-07).
import { useState } from "react";
import { Phone } from "lucide-react";
import { Button, Select, Textarea } from "@atelieros/ui";
import { trpc } from "@/trpc/react";
import type { PortalLabels } from "../../_components/labels";
import { linkProblemOf, PortalLinkState } from "../../_components/link-state";
import {
  StatusLabel,
  TYPES,
  fmtDay,
  fmtTime,
  ta,
  type AppointmentStatus,
  type AppointmentType,
} from "../../../(app)/rendez-vous/labels";

export function PortalAppointment({ token, labels }: { token: string; labels: PortalLabels }) {
  const view = trpc.portal.appointment.get.useQuery({ token }, { retry: false });
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [type, setType] = useState<AppointmentType | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const data = view.data;
  const chosenType = type ?? (data?.kind === "booking" ? data.defaultType : undefined);
  const needsSlots = data?.kind === "booking" || mode === "reschedule";
  const slots = trpc.portal.appointment.slots.useQuery(
    { token, type: data?.kind === "booking" ? chosenType : undefined },
    { enabled: !!data && needsSlots && !done },
  );
  const onError = () => slots.refetch();
  const book = trpc.portal.appointment.book.useMutation({
    onSuccess: (r) =>
      setDone(r.status === "CONFIRMED" ? ta("portal.booked") : ta("portal.bookedPending")),
    onError,
  });
  const confirm = trpc.portal.appointment.confirm.useMutation({
    onSuccess: () => setDone(ta("portal.confirmed")),
  });
  const cancel = trpc.portal.appointment.cancel.useMutation({
    onSuccess: () => setDone(ta("portal.cancelled")),
  });
  const reschedule = trpc.portal.appointment.reschedule.useMutation({
    onSuccess: () => setDone(ta("portal.rescheduled")),
    onError,
  });
  const mutationError = book.error ?? reschedule.error ?? confirm.error ?? cancel.error;

  if (view.isLoading) {
    return (
      <main className="mx-auto w-full max-w-md p-4 text-sm text-muted">{ta("portal.loading")}</main>
    );
  }
  if (view.isError || !data) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
        <PortalLinkState
          problem={linkProblemOf(view.error)}
          token={token}
          labels={labels}
          onRetry={() => view.refetch()}
        />
      </main>
    );
  }

  const tz = data.timeZone;
  const days = slots.data ?? [];
  const dayKeys = [...new Set(days.map((g) => g.date))];
  const activeDay = day ?? dayKeys[0] ?? null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <header className="flex flex-col gap-1 border-b border-border pb-3">
        <h1 className="text-xl font-semibold">{data.garage.name}</h1>
        {data.garage.address && <p className="text-sm text-muted">{data.garage.address}</p>}
        {data.garage.phone && (
          <a
            href={`tel:${data.garage.phone}`}
            className="btn btn-secondary btn-sm min-h-11 self-start"
          >
            <Phone size={14} aria-hidden /> {ta("portal.callGarage")}
          </a>
        )}
      </header>

      {done ? (
        <p
          role="status"
          className="rounded-lg border border-status-ok bg-status-ok-bg p-4 text-status-ok"
          data-testid="portal-done"
        >
          {done}
        </p>
      ) : (
        <>
          {data.kind === "appointment" && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{ta("portal.manageTitle")}</h2>
              <p className="font-medium" data-testid="portal-date">
                {data.appointment.dateLabel}
              </p>
              <p className="text-sm">
                {ta(`types.${data.appointment.type}`)}
                {data.appointment.vehicle
                  ? ` · ${data.appointment.vehicle.make} ${data.appointment.vehicle.model} (${data.appointment.vehicle.plate})`
                  : ""}
              </p>
              <StatusLabel status={data.appointment.status as AppointmentStatus} />
              {mode === "view" && (
                <div className="flex flex-col gap-2">
                  {data.canConfirm && (
                    <Button
                      className="min-h-11"
                      loading={confirm.isPending}
                      onClick={() => confirm.mutate({ token })}
                    >
                      {ta("portal.confirm")}
                    </Button>
                  )}
                  {data.canReschedule && (
                    <Button
                      variant="secondary"
                      className="min-h-11"
                      onClick={() => setMode("reschedule")}
                    >
                      {ta("portal.reschedule")}
                    </Button>
                  )}
                  {data.canCancel &&
                    (confirmCancel ? (
                      <Button
                        variant="danger"
                        className="min-h-11"
                        loading={cancel.isPending}
                        onClick={() => cancel.mutate({ token })}
                      >
                        {ta("portal.cancelConfirm")}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        onClick={() => setConfirmCancel(true)}
                      >
                        {ta("portal.cancel")}
                      </Button>
                    ))}
                </div>
              )}
            </section>
          )}

          {data.kind === "booking" && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{ta("portal.title")}</h2>
              {data.vehicle && (
                <p className="text-sm">
                  {ta("portal.vehicle", {
                    vehicle: `${data.vehicle.make} ${data.vehicle.model} (${data.vehicle.plate})`,
                  })}
                </p>
              )}
              <label className="flex flex-col gap-1 text-sm">
                {ta("portal.type")}
                <Select
                  value={chosenType}
                  onChange={(e) => {
                    setType(e.target.value as AppointmentType);
                    setSlot(null);
                  }}
                  className="min-h-11"
                >
                  {TYPES.filter((v) => data.portalTypes.includes(v)).map((v) => (
                    <option key={v} value={v}>
                      {ta(`types.${v}`)}
                    </option>
                  ))}
                </Select>
              </label>
            </section>
          )}

          {needsSlots && (
            <section className="flex flex-col gap-3">
              <h3 className="font-semibold">{ta("portal.chooseDay")}</h3>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {dayKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setDay(key);
                      setSlot(null);
                    }}
                    className={`min-h-11 shrink-0 rounded-md border px-3 text-sm ${key === activeDay ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
                  >
                    {fmtDay(new Date(`${key}T12:00:00Z`), "UTC")}
                  </button>
                ))}
              </div>
              {slots.isLoading && <p className="text-sm text-muted">{ta("portal.loading")}</p>}
              {slots.data && dayKeys.length === 0 && (
                <p className="text-sm text-muted">{ta("portal.noSlots")}</p>
              )}
              {(["AM", "PM"] as const).map((half) => {
                const group = days.find((g) => g.date === activeDay && g.halfDay === half);
                if (!group) return null;
                return (
                  <div key={half} className="flex flex-col gap-2">
                    <h4 className="text-sm text-muted">
                      {half === "AM" ? ta("portal.morning") : ta("portal.afternoon")}
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      {group.slots.map((s) => {
                        const iso = new Date(s).toISOString();
                        return (
                          <button
                            key={iso}
                            type="button"
                            data-testid="portal-slot"
                            onClick={() => setSlot(iso)}
                            className={`min-h-11 rounded-md border text-sm ${slot === iso ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
                          >
                            {fmtTime(s, tz)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {data.kind === "booking" && (
                <label className="flex flex-col gap-1 text-sm">
                  {ta("portal.comment")}
                  <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
                </label>
              )}
              {slot && (
                <p className="text-sm font-medium">
                  {ta("portal.summary", { date: `${fmtDay(slot, tz)} · ${fmtTime(slot, tz)}` })}
                </p>
              )}
              <Button
                className="min-h-11"
                disabled={!slot}
                loading={book.isPending || reschedule.isPending}
                onClick={() => {
                  if (!slot) return;
                  if (data.kind === "booking" && chosenType) {
                    book.mutate({
                      token,
                      startsAt: new Date(slot),
                      type: chosenType,
                      comment: comment || undefined,
                    });
                  } else {
                    reschedule.mutate({ token, startsAt: new Date(slot) });
                  }
                }}
              >
                {data.kind === "booking" ? ta("portal.book") : ta("portal.reschedule")}
              </Button>
            </section>
          )}
          {mutationError && (
            <p
              role="alert"
              className="rounded-md border border-status-bad bg-status-bad-bg p-3 text-sm text-status-bad"
            >
              {mutationError.message || ta("portal.error")}
            </p>
          )}
        </>
      )}
    </main>
  );
}
