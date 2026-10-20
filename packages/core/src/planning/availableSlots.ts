// RG-M03-07 (portail) et US-M03-02 (« Trouver un créneau ») — créneaux libres compatibles.
import type { HolidayLike } from "../calendar";
import type { OpeningHours } from "../organization/opening-hours";
import {
  checkCapacity,
  computeCapacity,
  halfDayBoundary,
  halfDayIntervals,
  halfDayOfMinutes,
  maxAppointmentsPerHalfDay,
  mechanicAvailableMinutes,
} from "./capacity";
import {
  isBayFree,
  isBlocking,
  type BlockLike,
  type ExistingAppointment,
  type OccupyingOrder,
} from "./conflicts";
import { openIntervalsForDay } from "./openingHours";
import { isBayCompatible } from "./settings";
import { addDaysToKey, localDateKey, overlapMinutes, zonedInstant } from "./time";
import type { AppointmentTypeKey, BayTypeKey, HalfDay, Interval } from "./types";

export interface SlotBay {
  id: string;
  type: BayTypeKey;
  isActive: boolean;
}

export interface PlanningSnapshot {
  timeZone: string;
  siteId: string;
  openingHours: OpeningHours;
  holidays: readonly HolidayLike[];
  lunchBreak: readonly [string, string] | null;
  productivityRate: number;
  configuredMaxPerHalfDay: number | null;
  bays: readonly SlotBay[];
  /** Mécaniciens rattachés au site (Membership.id). Vide = capacité non contrôlée. */
  mechanicIds: readonly string[];
  appointments: readonly (ExistingAppointment & { durationMinutes?: number })[];
  blocks: readonly BlockLike[];
  orders: readonly OccupyingOrder[];
  /** Charge restante estimée des OR en cours par demi-journée (M04/M06), en minutes. */
  extraLoadMinutes?: (dateKey: string, halfDay: HalfDay) => number;
}

export interface HalfDayLoad {
  date: string;
  halfDay: HalfDay;
  capacityMinutes: number | null;
  loadMinutes: number;
  appointmentsCount: number;
  maxAppointments: number | null;
  openMinutes: number;
}

/** RG-M03-05 — capacité, charge et nombre de RDV d'une demi-journée. */
export function halfDayLoad(
  snapshot: PlanningSnapshot,
  dateKey: string,
  halfDay: HalfDay,
  excludeId?: string,
): HalfDayLoad {
  const ctx = { ...snapshot, siteId: snapshot.siteId };
  const intervals = halfDayIntervals(dateKey, halfDay, ctx);
  const openMinutes = intervals.reduce((s, i) => s + overlapMinutes(i, i), 0);
  const capacityMinutes =
    snapshot.mechanicIds.length === 0
      ? null
      : computeCapacity(
          snapshot.mechanicIds.map((id) =>
            mechanicAvailableMinutes(id, intervals, snapshot.blocks),
          ),
          snapshot.productivityRate,
        );
  const boundary = halfDayBoundary(snapshot.lunchBreak);
  let loadMinutes = snapshot.extraLoadMinutes?.(dateKey, halfDay) ?? 0;
  let appointmentsCount = 0;
  for (const appt of snapshot.appointments) {
    if (appt.id === excludeId || !isBlocking(appt.status)) continue;
    if (localDateKey(appt.startsAt, snapshot.timeZone) !== dateKey) continue;
    const startMinutes =
      (appt.startsAt.getTime() - zonedInstant(dateKey, 0, snapshot.timeZone).getTime()) / 60_000;
    if (halfDayOfMinutes(startMinutes, boundary) !== halfDay) continue;
    appointmentsCount += 1;
    loadMinutes += Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60_000);
  }
  const activeBays = snapshot.bays.filter((b) => b.isActive).length;
  return {
    date: dateKey,
    halfDay,
    capacityMinutes,
    loadMinutes,
    appointmentsCount,
    maxAppointments: maxAppointmentsPerHalfDay(snapshot.configuredMaxPerHalfDay, activeBays),
    openMinutes,
  };
}

export interface AvailableSlotsInput {
  snapshot: PlanningSnapshot;
  now: Date;
  type: AppointmentTypeKey;
  durationMinutes: number;
  /** Premier jour civil examiné (`yyyy-MM-dd`, fuseau de l'organisation). */
  fromDate: string;
  days: number;
  stepMinutes: number;
  minLeadMinutes: number;
  /** Exiger un pont compatible libre (autoAssignBay, ou recherche staff). */
  requireBay: boolean;
  /** Plafond par demi-journée affiché (portail : 6, réparti uniformément). */
  maxPerHalfDay?: number;
  /** Nombre maximal de créneaux au total (staff : 10 prochains). */
  limit?: number;
  /** Plages ouvertes au portail (minutes locales), intersectées avec les horaires. */
  allowedRanges?: ReadonlyArray<readonly [number, number]>;
  mechanicId?: string | null;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  bayId?: string;
}

export interface SlotGroup {
  date: string;
  halfDay: HalfDay;
  slots: Slot[];
}

/** Sous-échantillon uniforme de `max` éléments (premier et dernier conservés). */
export function spreadEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return items.slice(0, max);
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    picked.push(items[Math.round((i * (items.length - 1)) / (max - 1))]!);
  }
  return picked;
}

function compatibleFreeBay(
  input: AvailableSlotsInput,
  interval: Interval,
): SlotBay | null | undefined {
  const sources = {
    appointments: input.snapshot.appointments,
    blocks: input.snapshot.blocks,
    orders: input.snapshot.orders,
  };
  const candidates = input.snapshot.bays.filter(
    (b) => b.isActive && isBayCompatible(input.type, b.type),
  );
  return candidates.find((bay) => isBayFree(bay.id, interval, sources)) ?? null;
}

export function availableSlots(input: AvailableSlotsInput): SlotGroup[] {
  const { snapshot } = input;
  const groups: SlotGroup[] = [];
  const earliest = input.now.getTime() + input.minLeadMinutes * 60_000;
  const boundary = halfDayBoundary(snapshot.lunchBreak);
  let total = 0;
  for (let offset = 0; offset < input.days; offset++) {
    const dateKey = addDaysToKey(input.fromDate, offset);
    const intervals = openIntervalsForDay(dateKey, snapshot);
    const perHalf: Record<HalfDay, Slot[]> = { AM: [], PM: [] };
    const loads: Partial<Record<HalfDay, ReturnType<typeof halfDayLoad>>> = {};
    for (const [from, to] of intervals) {
      const firstStart = Math.ceil(from / input.stepMinutes) * input.stepMinutes;
      for (let t = firstStart; t + input.durationMinutes <= to; t += input.stepMinutes) {
        if (
          input.allowedRanges &&
          !input.allowedRanges.some(([a, b]) => t >= a && t + input.durationMinutes <= b)
        ) {
          continue;
        }
        const startsAt = zonedInstant(dateKey, t, snapshot.timeZone);
        if (startsAt.getTime() < earliest) continue;
        const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
        const halfDay = halfDayOfMinutes(t, boundary);
        loads[halfDay] ??= halfDayLoad(snapshot, dateKey, halfDay);
        const load = loads[halfDay]!;
        const capacity = checkCapacity({
          capacityMinutes: load.capacityMinutes,
          loadMinutes: load.loadMinutes,
          durationMinutes: input.durationMinutes,
          appointmentsCount: load.appointmentsCount,
          maxAppointments: load.maxAppointments,
        });
        if (!capacity.ok) continue;
        if (input.mechanicId) {
          const busy = snapshot.appointments.some(
            (a) =>
              a.mechanicId === input.mechanicId &&
              isBlocking(a.status) &&
              a.startsAt < endsAt &&
              startsAt < a.endsAt,
          );
          const absent = snapshot.blocks.some(
            (b) =>
              b.membershipId === input.mechanicId && b.startsAt < endsAt && startsAt < b.endsAt,
          );
          if (busy || absent) continue;
        }
        const siteClosed = snapshot.blocks.some(
          (b) => !b.bayId && !b.membershipId && b.startsAt < endsAt && startsAt < b.endsAt,
        );
        if (siteClosed) continue;
        const slot: Slot = { startsAt, endsAt };
        if (input.requireBay) {
          const bay = compatibleFreeBay(input, { startsAt, endsAt });
          if (!bay) continue;
          slot.bayId = bay.id;
        }
        perHalf[halfDay].push(slot);
      }
    }
    for (const halfDay of ["AM", "PM"] as const) {
      let slots = perHalf[halfDay];
      if (slots.length === 0) continue;
      if (input.maxPerHalfDay) slots = spreadEvenly(slots, input.maxPerHalfDay);
      if (input.limit !== undefined) {
        slots = slots.slice(0, Math.max(0, input.limit - total));
        if (slots.length === 0) return groups;
      }
      total += slots.length;
      groups.push({ date: dateKey, halfDay, slots });
    }
    if (input.limit !== undefined && total >= input.limit) break;
  }
  return groups;
}
