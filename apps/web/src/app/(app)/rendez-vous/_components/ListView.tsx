"use client";

import { Button, EmptyState, StatusBadge } from "@atelieros/ui";
import { t } from "@/i18n/t";
import { SOURCE_ICONS, STATUS_META, TYPE_COLORS, statusLabel, typeLabel } from "../_lib/labels";
import { formatTime, minutesOfDay } from "../_lib/time";
import type { PlanningAppointment } from "../_lib/types";

export interface ListViewProps {
  timeZone: string;
  appointments: PlanningAppointment[];
  onSelect: (id: string) => void;
  actions?: (appointment: PlanningAppointment) => React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Vue Liste (mobile par défaut) : cartes chronologiques groupées par demi-journée. */
export function ListView(props: ListViewProps) {
  if (props.appointments.length === 0) {
    return (
      <EmptyState
        title={props.emptyTitle ?? t("appointments.empty.title")}
        description={props.emptyDescription ?? t("appointments.empty.description")}
      />
    );
  }
  const morning = props.appointments.filter(
    (a) => minutesOfDay(a.startsAt, props.timeZone) < 13 * 60,
  );
  const afternoon = props.appointments.filter(
    (a) => minutesOfDay(a.startsAt, props.timeZone) >= 13 * 60,
  );
  const groups = [
    { key: "am", label: t("appointments.capacity.am"), items: morning },
    { key: "pm", label: t("appointments.capacity.pm"), items: afternoon },
  ].filter((g) => g.items.length > 0);
  return (
    <div className="pl-list">
      {groups.map((group) => (
        <div key={group.key} className="group">
          <div className="section-label">{group.label}</div>
          {group.items.map((a) => (
            <div
              key={a.id}
              className="row"
              style={{ ["--type-color" as string]: TYPE_COLORS[a.type] }}
              onClick={() => props.onSelect(a.id)}
            >
              <div className="t num">{formatTime(a.startsAt, props.timeZone)}</div>
              <div className="main">
                <b>{a.customer.displayName}</b>
                <span>
                  {a.vehicle
                    ? `${a.vehicle.make} ${a.vehicle.model} · ${a.vehicle.plate}`
                    : t("appointments.fields.noVehicle")}{" "}
                  · {typeLabel(a.type)} · {a.bay?.name ?? t("appointments.fields.unassignedBay")}
                </span>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    marginTop: 4,
                    alignItems: "center",
                  }}
                >
                  <StatusBadge
                    tone={STATUS_META[a.status].tone}
                    label={`${STATUS_META[a.status].icon} ${statusLabel(a.status)}`}
                  />
                  <span className="pl-src">{SOURCE_ICONS[a.source]}</span>
                  {a.flags.late ? (
                    <span className="pl-flag bad">{t("appointments.badges.late")}</span>
                  ) : null}
                  {a.flags.noShowCount12m >= 2 ? (
                    <span className="pl-flag bad">
                      {t("appointments.badges.noShows", { count: a.flags.noShowCount12m })}
                    </span>
                  ) : null}
                  {a.overbooked ? (
                    <span className="pl-flag">⚠ {t("appointments.badges.overbooked")}</span>
                  ) : null}
                  {!a.flags.reachable ? (
                    <span className="pl-flag off">{t("appointments.badges.unreachable")}</span>
                  ) : null}
                </div>
              </div>
              {props.actions ? (
                <div className="acts" onClick={(e) => e.stopPropagation()}>
                  {props.actions(a)}
                </div>
              ) : (
                <Button size="sm" variant="ghost">
                  {t("appointments.actions.viewDetails")}
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
