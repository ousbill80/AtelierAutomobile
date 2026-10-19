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
      className={`flex min-h-11 w-full flex-col gap-1 rounded-lg border bg-surface p-3 text-left hover:bg-surface-2 ${a.flags.late ? "border-status-bad" : "border-border"}`}
    >
      <div className="flex w-full flex-wrap items-center gap-2">
        <span className="font-semibold">
          {fmtTime(a.startsAt, tz)}–{fmtTime(a.endsAt, tz)}
        </span>
        <StatusLabel status={a.status as AppointmentStatus} />
        <SourceIcon source={a.source as AppointmentSource} />
        {a.flags.late && <span className="pill pill-bad">{ta("badges.late")}</span>}
        {a.flags.noShowCount >= 2 && (
          <span className="pill pill-bad">
            {ta("badges.noShows", { count: a.flags.noShowCount })}
          </span>
        )}
      </div>
      <span className="truncate font-medium">{a.customer.displayName}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <TypeDot type={a.type as AppointmentType} />
        {a.vehicle && (
          <span className="truncate">
            {a.vehicle.make} {a.vehicle.model} · {a.vehicle.plate}
          </span>
        )}
        <span>{a.bay?.name ?? ta("unassigned")}</span>
      </div>
    </button>
  );
}
