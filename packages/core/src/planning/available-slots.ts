import type { HolidayLike } from "../calendar";
import type { OpeningHours } from "../organization/opening-hours";
import {
  canAcceptAppointment,
  computeCapacity,
  halfDayWindows,
  type HalfDayWindow,
} from "./capacity";
import { detectConflicts } from "./conflicts";
import { isBayCompatible } from "./durations";
import { nextCivilDay, startOfCivilDay } from "./opening-hours";
import type {
  AppointmentLike,
  AppointmentType,
  BayLike,
  BlockLike,
  HalfDay,
  OccupyingOrderLike,
} from "./types";

export interface AvailableSlotsInput {
  /** Premier jour examiné (instant quelconque de ce jour). */
  from: Date;
  /** Horloge injectée : délai minimum calculé à partir de `now`. */
  now: Date;
  /** Nombre de jours examinés (horizon). */
  days: number;
  timeZone: string;
  openingHours: OpeningHours;
  holidays?: readonly HolidayLike[];
  siteId?: string | null;
  lunchBreak?: readonly [string, string] | null;
  type: AppointmentType;
  durationMinutes: number;
  stepMinutes: number;
  minLeadMinutes: number;
  bays: readonly BayLike[];
  appointments: readonly AppointmentLike[];
  blocks?: readonly BlockLike[];
  occupyingOrders?: readonly OccupyingOrderLike[];
  /** Si vrai, un pont compatible libre est exigé (créneau rendu avec `bayId`). */
  requireBay: boolean;
  /** Filtre : ne proposer que ce pont (ou ce type de pont). */
  bayId?: string | null;
  /** Filtre : mécanicien devant être libre. */
  mechanicId?: string | null;
  mechanicIds: readonly string[];
  productivityRate: number;
  maxAppointmentsPerHalfDay: number | null;
  /** Plafond de créneaux renvoyés par demi-journée (portail : 6, répartis uniformément). */
  maxPerHalfDay?: number | null;
  /** Nombre total maximal de créneaux (ex. « 10 prochains créneaux » de l'assistant). */
  limit?: number | null;
}

export interface SlotCandidate {
  startsAt: Date;
  endsAt: Date;
  bayId: string | null;
}

export interface HalfDaySlots {
  date: string;
  halfDay: HalfDay;
  slots: SlotCandidate[];
}

/** Sous-ensemble de `count` éléments répartis uniformément (ne pas dévoiler l'occupation exacte). */
export function spreadEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]!];
  const result: T[] = [];
  const step = (items.length - 1) / (count - 1);
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const index = Math.round(i * step);
    if (!seen.has(index)) {
      seen.add(index);
      result.push(items[index]!);
    }
  }
  return result;
}

/** Premier pont compatible et libre sur la plage, dans l'ordre fourni (RG-M03-03 : autoAssignBay). */
export function findFreeBay(
  input: Pick<
    AvailableSlotsInput,
    "bays" | "type" | "appointments" | "blocks" | "occupyingOrders" | "bayId"
  > & { startsAt: Date; endsAt: Date; dayEnd?: Date; excludeAppointmentId?: string | null },
): BayLike | undefined {
  return input.bays.find((bay) => {
    if (!bay.isActive) return false;
    if (input.bayId && bay.id !== input.bayId) return false;
    if (!isBayCompatible(input.type, bay.type)) return false;
    const conflicts = detectConflicts({
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      bayId: bay.id,
      excludeAppointmentId: input.excludeAppointmentId,
      appointments: input.appointments,
      blocks: input.blocks,
      occupyingOrders: input.occupyingOrders,
      dayEnd: input.dayEnd,
    });
    return conflicts.length === 0;
  });
}

/**
 * RG-M03-07 — créneaux disponibles groupés par jour et demi-journée. Pour chaque début `t`
 * aligné sur le pas : `[t, t+durée]` dans une plage d'ouverture, `t ≥ now + délai`, pont
 * compatible libre (si exigé), mécanicien libre (si précisé), capacité restante suffisante.
 */
export function availableSlots(input: AvailableSlotsInput): HalfDaySlots[] {
  const result: HalfDaySlots[] = [];
  const durationMs = input.durationMinutes * 60_000;
  const stepMs = Math.max(5, input.stepMinutes) * 60_000;
  const earliest = new Date(input.now.getTime() + input.minLeadMinutes * 60_000);
  const activeBayCount = input.bays.filter((b) => b.isActive).length;
  let total = 0;

  let day = startOfCivilDay(input.from, input.timeZone);
  for (let i = 0; i < input.days; i++, day = nextCivilDay(day, input.timeZone)) {
    const windows = halfDayWindows(input.openingHours, day, input.timeZone, {
      lunchBreak: input.lunchBreak,
      holidays: input.holidays,
      siteId: input.siteId,
    });
    const dayEnd = windows.length > 0 ? windows[windows.length - 1]!.end : undefined;

    for (const window of windows) {
      const capacity = computeCapacity({
        window,
        mechanicIds: input.mechanicIds,
        blocks: input.blocks,
        productivityRate: input.productivityRate,
        appointments: input.appointments,
        occupyingOrders: input.occupyingOrders,
        maxAppointmentsPerHalfDay: input.maxAppointmentsPerHalfDay,
        activeBayCount,
      });
      if (!canAcceptAppointment(capacity, input.durationMinutes).ok) {
        continue;
      }
      const slots = collectWindowSlots(input, window, earliest, durationMs, stepMs, dayEnd);
      const kept = input.maxPerHalfDay != null ? spreadEvenly(slots, input.maxPerHalfDay) : slots;
      if (kept.length === 0) continue;
      if (input.limit != null && total + kept.length > input.limit) {
        const remaining = input.limit - total;
        if (remaining <= 0) return result;
        result.push({
          date: window.date,
          halfDay: window.halfDay,
          slots: kept.slice(0, remaining),
        });
        return result;
      }
      total += kept.length;
      result.push({ date: window.date, halfDay: window.halfDay, slots: kept });
    }
  }
  return result;
}

function collectWindowSlots(
  input: AvailableSlotsInput,
  window: HalfDayWindow,
  earliest: Date,
  durationMs: number,
  stepMs: number,
  dayEnd: Date | undefined,
): SlotCandidate[] {
  const slots: SlotCandidate[] = [];
  for (let t = window.start.getTime(); t + durationMs <= window.end.getTime(); t += stepMs) {
    const startsAt = new Date(t);
    if (startsAt < earliest) continue;
    const endsAt = new Date(t + durationMs);

    if (input.mechanicId) {
      const mechanicConflicts = detectConflicts({
        startsAt,
        endsAt,
        mechanicId: input.mechanicId,
        appointments: input.appointments,
        blocks: input.blocks,
      });
      if (mechanicConflicts.length > 0) continue;
    } else {
      const siteBlocked = detectConflicts({
        startsAt,
        endsAt,
        appointments: [],
        blocks: input.blocks,
      }).some((c) => c.kind === "SITE_BLOCK");
      if (siteBlocked) continue;
    }

    let bayId: string | null = null;
    if (input.requireBay || input.bayId) {
      const bay = findFreeBay({ ...input, startsAt, endsAt, dayEnd });
      if (!bay) continue;
      bayId = bay.id;
    }
    slots.push({ startsAt, endsAt, bayId });
  }
  return slots;
}
