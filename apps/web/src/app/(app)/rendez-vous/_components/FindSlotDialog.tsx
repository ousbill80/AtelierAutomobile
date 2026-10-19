"use client";

import { Modal, Select, Field, Input, EmptyState } from "@atelieros/ui";
import { useState } from "react";
import { t } from "@/i18n/t";
import { trpc } from "@/trpc/client";
import { APPOINTMENT_TYPES, typeLabel, type AppointmentTypeKey } from "../_lib/labels";
import { formatLongDay, formatTime, instantAt } from "../_lib/time";

export interface FindSlotDialogProps {
  open: boolean;
  onClose: () => void;
  siteId: string;
  timeZone: string;
  type: AppointmentTypeKey;
  durationMinutes?: number;
  fromDay: string;
  onPick: (slot: { startsAt: Date; bayId: string | null }) => void;
}

/** US-M03-02 — « Trouver un créneau » : les 10 prochains créneaux compatibles. */
export function FindSlotDialog(props: FindSlotDialogProps) {
  const [type, setType] = useState<AppointmentTypeKey>(props.type);
  const [fromDay, setFromDay] = useState(props.fromDay);
  const slots = trpc.planning.availableSlots.useQuery(
    {
      siteId: props.siteId,
      type,
      durationMinutes: props.durationMinutes,
      from: instantAt(fromDay, "00:00", props.timeZone),
      days: 14,
      limit: 10,
      requireBay: true,
    },
    { enabled: props.open },
  );
  const total = slots.data?.days.reduce((n, d) => n + d.slots.length, 0) ?? 0;

  return (
    <Modal open={props.open} onClose={props.onClose} title={t("appointments.slots.title")}>
      <p className="hint" style={{ marginTop: 0 }}>
        {t("appointments.slots.hint")}
      </p>
      <div className="pl-inline">
        <Field label={t("appointments.slots.type")}>
          <Select value={type} onChange={(e) => setType(e.target.value as AppointmentTypeKey)}>
            {APPOINTMENT_TYPES.map((key) => (
              <option key={key} value={key}>
                {typeLabel(key)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("appointments.slots.from")}>
          <Input type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />
        </Field>
      </div>
      {slots.isLoading ? <div className="skeleton" style={{ height: 120 }} /> : null}
      {slots.data && total === 0 ? <EmptyState title={t("appointments.empty.noSlots")} /> : null}
      <div className="pl-slots">
        {slots.data?.days.map((day) => (
          <div key={`${day.date}-${day.halfDay}`}>
            <div className="day">
              {formatLongDay(day.date, props.timeZone)} ·{" "}
              {day.halfDay === "AM" ? t("appointments.capacity.am") : t("appointments.capacity.pm")}
            </div>
            <div className="chips">
              {day.slots.map((slot) => (
                <button
                  type="button"
                  key={slot.startsAt.toISOString()}
                  className="pl-chip"
                  onClick={() => props.onPick(slot)}
                >
                  {formatTime(slot.startsAt, props.timeZone)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
