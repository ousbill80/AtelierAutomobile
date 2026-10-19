"use client";

import { t } from "@/i18n/t";
import { TYPE_COLORS } from "../_lib/labels";
import { addDays, civilDay, formatShortDay, formatTime } from "../_lib/time";
import type { PlanningAppointment } from "../_lib/types";

export interface WeekViewProps {
  weekStart: string;
  timeZone: string;
  appointments: PlanningAppointment[];
  capacity: Array<{
    date: string;
    halfDay: string;
    occupancy: number;
    capacityMinutes: number;
    loadMinutes: number;
  }>;
  onSelectDay: (day: string) => void;
  onSelect: (id: string) => void;
}

/** US-M03-11 — vue Semaine : RDV par jour, taux d'occupation en jauge (vert < 70 %, orange 70-90 %, rouge > 90 %). */
export function WeekView(props: WeekViewProps) {
  const days = Array.from({ length: 6 }, (_, i) => addDays(props.weekStart, i));
  return (
    <div className="pl-week">
      {days.map((day) => {
        const items = props.appointments.filter(
          (a) => civilDay(a.startsAt, props.timeZone) === day && a.status !== "CANCELLED",
        );
        const caps = props.capacity.filter((c) => c.date === day);
        const capacityMinutes = caps.reduce((n, c) => n + c.capacityMinutes, 0);
        const loadMinutes = caps.reduce((n, c) => n + c.loadMinutes, 0);
        const occupancy = capacityMinutes > 0 ? Math.min(1, loadMinutes / capacityMinutes) : 0;
        const closed = caps.length === 0;
        const tone = occupancy > 0.9 ? "bad" : occupancy >= 0.7 ? "warn" : "";
        return (
          <div key={day} className={["pl-day", closed ? "closed" : ""].join(" ")}>
            <div
              className="dh"
              role="button"
              tabIndex={0}
              onClick={() => props.onSelectDay(day)}
              onKeyDown={(e) => e.key === "Enter" && props.onSelectDay(day)}
            >
              <span>{formatShortDay(day, props.timeZone)}</span>
              <small>{t("appointments.week.appointments", { count: items.length })}</small>
            </div>
            {!closed ? (
              <div className={["pl-gauge", tone].join(" ")} style={{ padding: "6px 8px" }}>
                <div className="head">
                  <span>
                    {t("appointments.week.occupancy", { percent: Math.round(occupancy * 100) })}
                  </span>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.round(occupancy * 100)}%` }} />
                </div>
              </div>
            ) : null}
            {items.slice(0, 8).map((a) => (
              <div
                key={a.id}
                className="item"
                style={{ ["--type-color" as string]: TYPE_COLORS[a.type] }}
                onClick={() => props.onSelect(a.id)}
              >
                <span className="t">{formatTime(a.startsAt, props.timeZone)}</span>
                <span
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {a.customer.displayName}
                </span>
              </div>
            ))}
            {items.length > 8 ? <div className="more">+{items.length - 8}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
