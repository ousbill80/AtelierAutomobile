"use client";

import {
  SourceIcon,
  StatusLabel,
  TypeDot,
  fmtTime,
  ta,
  type AppointmentSource,
  type AppointmentStatus,
  type AppointmentType,
} from "./labels";
import type { PlanningAppointment } from "./types";

/** Carte chronologique d'un RDV (vue Liste, mobile, écran Aujourd'hui). */
export function AppointmentRow({
  a,
  tz,
  onSelect,
}: {
  a: PlanningAppointment;
  tz: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid="appt-row"
      data-appointment-id={a.id}
      onClick={() => onSelect(a.id)}
      className={`planning-list-item w-full text-left ${a.flags.late ? "late" : ""}`}
    >
      <span className="planning-list-time">
        {fmtTime(a.startsAt, tz)}
      </span>
      <div className="planning-list-info">
        <div className="planning-list-client">{a.customer.displayName}</div>
        <div className="planning-list-vehicle mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <TypeDot type={a.type as AppointmentType} />
          {a.vehicle && (
            <span>
              {a.vehicle.make} {a.vehicle.model} · {a.vehicle.plate}
            </span>
          )}
          {!a.vehicle && <span>{a.bay?.name ?? ta("unassigned")}</span>}
        </div>
      </div>
      <div className="planning-list-badges">
        <StatusLabel status={a.status as AppointmentStatus} />
        <SourceIcon source={a.source as AppointmentSource} />
        {a.flags.late && <span className="pill pill-bad">{ta("badges.late")}</span>}
        {a.flags.noShowCount >= 2 && (
          <span className="pill pill-bad">
            {ta("badges.noShows", { count: a.flags.noShowCount })}
          </span>
        )}
      </div>
    </button>
  );
}
