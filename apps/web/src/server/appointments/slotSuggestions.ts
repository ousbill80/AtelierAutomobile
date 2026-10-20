// US-M03-05 / US-M17-02 — calcul (sans IA) des 3 premiers créneaux libres correspondant à une
// préférence (« samedi matin »). Partagé par `planning.suggestSlot` (conseiller) et par la
// boîte de réception M17 (message entrant, sans utilisateur connecté).
import {
  REQUIRED_BAY_TYPES,
  addDaysToKey,
  availableSlots,
  defaultDuration,
  formatDayFr,
  formatTimeFr,
  isBayCompatible,
  localDateKey,
  type AppointmentTypeKey,
  type HalfDay,
  type SlotPreference,
} from "@atelieros/core";
import type { Organization } from "@atelieros/db";
import { dayBounds, loadPlanning, planningConfigOf, type Tx } from "./service";

/** Exiger un pont compatible : le type en demande un ET le site en possède au moins un. */
export function needsBay(
  type: AppointmentTypeKey,
  bays: Array<{ type: string; isActive: boolean }>,
) {
  return (
    REQUIRED_BAY_TYPES[type] !== null &&
    bays.some((b) => b.isActive && isBayCompatible(type, b.type as never))
  );
}

export interface SlotSuggestion {
  startsAt: Date;
  bayId: string | null;
  reason: string;
  label: string;
}

export async function computeSlotSuggestions(
  tx: Tx,
  input: {
    org: Organization;
    site: { id: string } & Record<string, unknown>;
    type: AppointmentTypeKey;
    preference: Pick<SlotPreference, "date" | "halfDay" | "label">;
    now: Date;
    limit?: number;
  },
): Promise<SlotSuggestion[]> {
  const { org, site, type, preference, now } = input;
  const config = planningConfigOf(org);
  const fromDate = preference.date ?? localDateKey(now, org.timezone);
  const days = preference.date ? 1 : 14;
  const { from } = dayBounds(fromDate, org.timezone);
  const { to } = dayBounds(addDaysToKey(fromDate, days - 1), org.timezone);
  const planning = await loadPlanning(tx, { org, site: site as never, from, to, now });
  const duration = defaultDuration(type, [], config.appointments.durations);
  const groups = availableSlots({
    snapshot: planning.snapshot,
    now,
    type,
    durationMinutes: duration,
    fromDate,
    days,
    stepMinutes: config.appointments.slotStepMinutes,
    minLeadMinutes: 0,
    requireBay: needsBay(type, planning.bays),
  }).filter((g) => !preference.halfDay || g.halfDay === (preference.halfDay as HalfDay));
  return groups
    .flatMap((g) => g.slots)
    .slice(0, input.limit ?? 3)
    .map((s) => ({
      startsAt: s.startsAt,
      bayId: s.bayId ?? null,
      reason: preference.label
        ? `Créneau libre le plus proche de « ${preference.label} »`
        : "Prochain créneau libre",
      label: `${formatDayFr(s.startsAt, org.timezone)} à ${formatTimeFr(s.startsAt, org.timezone)}${
        s.bayId ? `, ${planning.bays.find((b) => b.id === s.bayId)?.name ?? ""}` : ""
      }`,
    }));
}
