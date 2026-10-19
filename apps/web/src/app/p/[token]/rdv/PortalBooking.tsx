"use client";

import { useMemo, useState } from "react";
import { TrpcProvider } from "@/trpc/Provider";
import { trpc } from "@/trpc/client";
import { t } from "@/i18n/t";
import {
  formatDate,
  formatLongDay,
  formatShortDay,
  formatTime,
} from "@/app/(app)/rendez-vous/_lib/time";
import { typeLabel } from "@/app/(app)/rendez-vous/_lib/labels";

export function PortalBooking({ token }: { token: string }) {
  return (
    <TrpcProvider>
      <PortalBookingScreen token={token} />
    </TrpcProvider>
  );
}

type Phase = "pick" | "done" | "confirmed" | "cancelled" | "moved";

function PortalBookingScreen({ token }: { token: string }) {
  const view = trpc.portal.appointment.get.useQuery({ token }, { retry: false });
  const [type, setType] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<Date | null>(null);
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<Phase>("pick");
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const data = view.data;
  const tz = data?.garage.timeZone ?? "Africa/Abidjan";
  const effectiveType = type ?? data?.appointment?.type ?? data?.portalTypes[0] ?? "SERVICE";
  const wantSlots = Boolean(data) && (data?.scope === "BOOKING" || rescheduling);
  const slots = trpc.portal.appointment.slots.useQuery(
    { token, type: effectiveType as "SERVICE" },
    { enabled: wantSlots, retry: false },
  );

  const days = useMemo(() => {
    const map = new Map<string, Array<{ startsAt: Date; halfDay: string }>>();
    for (const d of slots.data?.days ?? []) {
      const list = map.get(d.date) ?? [];
      for (const s of d.slots) list.push({ startsAt: s.startsAt, halfDay: d.halfDay });
      map.set(d.date, list);
    }
    return map;
  }, [slots.data]);
  const activeDay = day ?? [...days.keys()][0] ?? null;

  const onError = (err: { message: string }) => {
    setError(err.message);
    setStartsAt(null);
    utils.portal.appointment.slots.invalidate();
  };
  const book = trpc.portal.appointment.book.useMutation({
    onSuccess: () => setPhase("done"),
    onError,
  });
  const confirm = trpc.portal.appointment.confirm.useMutation({
    onSuccess: () => setPhase("confirmed"),
    onError,
  });
  const cancel = trpc.portal.appointment.cancel.useMutation({
    onSuccess: () => setPhase("cancelled"),
    onError,
  });
  const reschedule = trpc.portal.appointment.reschedule.useMutation({
    onSuccess: () => setPhase("moved"),
    onError,
  });

  if (view.isLoading) return <div className="skel" />;
  if (view.error || !data) {
    return (
      <div className="box err">
        <h1>{t("portal.rdv.title")}</h1>
        <p>{view.error?.message ?? t("portal.rdv.invalid")}</p>
      </div>
    );
  }

  const header = (
    <>
      <h1>{data.garage.name}</h1>
      <p className="muted">
        {data.garage.siteName}
        {data.garage.address ? ` · ${data.garage.address}` : ""}
        {data.garage.phone ? (
          <>
            {" "}
            · <a href={`tel:${data.garage.phone}`}>{data.garage.phone}</a>
          </>
        ) : null}
      </p>
      {data.vehicle ? (
        <div className="box">
          <b>{t("portal.rdv.yourVehicle")}</b>
          <div>{data.vehicle.label}</div>
          {data.vehicle.inspectionExpiryDate ? (
            <div className="muted">
              {t("portal.rdv.inspectionExpiry", {
                date: formatDate(data.vehicle.inspectionExpiryDate, tz),
              })}
            </div>
          ) : null}
          {data.vehicle.nextServiceDueDate ? (
            <div className="muted">
              {t("portal.rdv.serviceDue", {
                date: formatDate(data.vehicle.nextServiceDueDate, tz),
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (phase !== "pick") {
    const text =
      phase === "done"
        ? data.requiresApproval
          ? t("portal.rdv.bookedPending")
          : t("portal.rdv.booked")
        : phase === "confirmed"
          ? t("portal.rdv.confirmed")
          : phase === "cancelled"
            ? t("portal.rdv.cancelled")
            : t("portal.rdv.moved");
    return (
      <>
        {header}
        <div className="box ok">
          <b>{text}</b>
          {startsAt ? (
            <div style={{ textTransform: "capitalize" }}>
              {formatLongDay(startsAt, tz)} · {formatTime(startsAt, tz)}
            </div>
          ) : null}
          {data.appointment && !startsAt ? (
            <div style={{ textTransform: "capitalize" }}>
              {formatLongDay(data.appointment.startsAt, tz)} ·{" "}
              {formatTime(data.appointment.startsAt, tz)}
            </div>
          ) : null}
        </div>
      </>
    );
  }

  const slotPicker = (
    <>
      <h2>{t("portal.rdv.chooseDay")}</h2>
      {slots.isLoading ? <div className="skel" /> : null}
      {slots.error ? <div className="box err">{slots.error.message}</div> : null}
      {slots.data && days.size === 0 ? (
        <div className="box">
          {t("portal.rdv.noSlots")}{" "}
          {data.garage.phone ? (
            <a href={`tel:${data.garage.phone}`}>
              {t("portal.rdv.callUs", { phone: data.garage.phone })}
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="days">
        {[...days.keys()].map((d) => (
          <button
            key={d}
            type="button"
            className={["day", d === activeDay ? "active" : ""].join(" ")}
            onClick={() => {
              setDay(d);
              setStartsAt(null);
            }}
          >
            <b>{formatShortDay(d, tz).split(" ")[0]}</b>
            {formatShortDay(d, tz).split(" ")[1]}
          </button>
        ))}
      </div>
      {activeDay ? (
        <>
          <h2>{t("portal.rdv.chooseSlot")}</h2>
          {(["AM", "PM"] as const).map((half) => {
            const items = (days.get(activeDay) ?? []).filter((s) => s.halfDay === half);
            if (items.length === 0) return null;
            return (
              <div key={half} style={{ marginBottom: 10 }}>
                <div className="muted">
                  {half === "AM" ? t("portal.rdv.morning") : t("portal.rdv.afternoon")}
                </div>
                <div className="slots">
                  {items.map((s) => (
                    <button
                      key={s.startsAt.toISOString()}
                      type="button"
                      className={[
                        "slot",
                        startsAt?.getTime() === s.startsAt.getTime() ? "active" : "",
                      ].join(" ")}
                      onClick={() => setStartsAt(s.startsAt)}
                    >
                      {formatTime(s.startsAt, tz)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </>
  );

  if (data.scope === "APPOINTMENT" && data.appointment) {
    const a = data.appointment;
    return (
      <>
        {header}
        <h2>{t("portal.rdv.yourAppointment")}</h2>
        <div className="box">
          <div style={{ textTransform: "capitalize" }}>
            <b>
              {formatLongDay(a.startsAt, tz)} · {formatTime(a.startsAt, tz)}
            </b>
          </div>
          <div>{typeLabel(a.type)}</div>
          <div className="muted">
            {t("portal.rdv.statusLabel")} :{" "}
            <span className="status">{t(`appointments.statuses.${a.status}`)}</span>
          </div>
        </div>
        {error ? <div className="box err">{error}</div> : null}
        {a.status === "BOOKED" || a.status === "CONFIRMED" ? (
          !rescheduling && !cancelling ? (
            <>
              {a.status === "BOOKED" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => confirm.mutate({ token })}
                  disabled={confirm.isPending}
                >
                  {t("portal.rdv.confirm")}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRescheduling(true)}
              >
                {t("portal.rdv.reschedule")}
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setCancelling(true)}>
                {t("portal.rdv.cancel")}
              </button>
            </>
          ) : cancelling ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => cancel.mutate({ token })}
                disabled={cancel.isPending}
              >
                {t("portal.rdv.cancelConfirm")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCancelling(false)}
              >
                {t("portal.rdv.back")}
              </button>
            </>
          ) : (
            <>
              {slotPicker}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!startsAt || reschedule.isPending}
                onClick={() => startsAt && reschedule.mutate({ token, startsAt })}
              >
                {t("portal.rdv.reschedule")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRescheduling(false)}
              >
                {t("portal.rdv.back")}
              </button>
            </>
          )
        ) : null}
      </>
    );
  }

  return (
    <>
      {header}
      <h2>{t("portal.rdv.chooseType")}</h2>
      <div className="types">
        {data.portalTypes.map((key) => (
          <button
            key={key}
            type="button"
            className={["type", key === effectiveType ? "active" : ""].join(" ")}
            onClick={() => {
              setType(key);
              setStartsAt(null);
            }}
          >
            {typeLabel(key)}
          </button>
        ))}
      </div>
      {slotPicker}
      {startsAt ? (
        <div className="box">
          <b>{t("portal.rdv.summary")}</b>
          <div style={{ textTransform: "capitalize" }}>
            {t("portal.rdv.summaryLine", {
              type: typeLabel(effectiveType),
              date: `${formatLongDay(startsAt, tz)} · ${formatTime(startsAt, tz)}`,
            })}
          </div>
          <label className="muted" htmlFor="portal-comment">
            {t("portal.rdv.comment")}
          </label>
          <textarea
            id="portal-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={1000}
          />
        </div>
      ) : null}
      {error ? <div className="box err">{error}</div> : null}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!startsAt || book.isPending}
        onClick={() =>
          startsAt &&
          book.mutate({
            token,
            startsAt,
            type: effectiveType as "SERVICE",
            comment: comment || undefined,
          })
        }
      >
        {t("portal.rdv.book")}
      </button>
    </>
  );
}
