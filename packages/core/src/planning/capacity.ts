import type { HolidayLike } from "../calendar";
import type { OpeningHours } from "../organization/opening-hours";
import { civilDay, openingRangesForDay } from "./opening-hours";
import { overlaps } from "./conflicts";
import type { AppointmentLike, BlockLike, HalfDay, OccupyingOrderLike, TimeRange } from "./types";
import { BLOCKING_STATUSES } from "./conflicts";

export interface HalfDayWindow extends TimeRange {
  /** Jour civil `yyyy-MM-dd` (fuseau de l'organisation). */
  date: string;
  halfDay: HalfDay;
}

/**
 * Demi-journées d'un jour : la première plage d'ouverture est le matin (`AM`), les suivantes
 * l'après-midi (`PM`). Un samedi 08:00-14:00 d'une seule plage = une seule demi-journée `AM`
 * (exemple RG-M03-05). Vide si le jour est fermé.
 */
export function halfDayWindows(
  openingHours: OpeningHours,
  date: Date,
  timeZone: string,
  options: {
    lunchBreak?: readonly [string, string] | null;
    holidays?: readonly HolidayLike[];
    siteId?: string | null;
  } = {},
): HalfDayWindow[] {
  const ranges = openingRangesForDay(openingHours, date, timeZone, options);
  if (ranges.length === 0) return [];
  const day = civilDay(date, timeZone);
  const [first, ...rest] = ranges;
  const windows: HalfDayWindow[] = [
    { date: day, halfDay: "AM", start: first!.start, end: first!.end },
  ];
  if (rest.length > 0) {
    windows.push({
      date: day,
      halfDay: "PM",
      start: rest[0]!.start,
      end: rest[rest.length - 1]!.end,
    });
  }
  return windows;
}

/** Demi-journée contenant un instant (ou la plus proche si hors plage). */
export function halfDayOf(windows: readonly HalfDayWindow[], at: Date): HalfDayWindow | undefined {
  return (
    windows.find((w) => at >= w.start && at < w.end) ??
    windows.find((w) => at < w.end) ??
    windows[windows.length - 1]
  );
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / 60_000);
}

/** Minutes de `[start, end)` intersectées avec `window`. */
export function clippedMinutes(start: Date, end: Date, window: TimeRange): number {
  const s = start > window.start ? start : window.start;
  const e = end < window.end ? end : window.end;
  return minutesBetween(s, e);
}

export interface ComputeCapacityInput {
  window: HalfDayWindow;
  /** Mécaniciens rattachés au site, actifs ce jour-là (RG-M03-06). */
  mechanicIds: readonly string[];
  blocks?: readonly BlockLike[];
  productivityRate: number;
  appointments: readonly AppointmentLike[];
  occupyingOrders?: readonly OccupyingOrderLike[];
  /** `null` = nombre de ponts actifs × 2. */
  maxAppointmentsPerHalfDay: number | null;
  activeBayCount: number;
}

export interface CapacityResult {
  date: string;
  halfDay: HalfDay;
  capacityMinutes: number;
  loadMinutes: number;
  appointmentsCount: number;
  maxAppointments: number;
  mechanicsPresent: number;
}

/**
 * RG-M03-05 — capacité d'une demi-journée = Σ minutes disponibles des mécaniciens présents
 * × taux de productivité ; charge = Σ durées des RDV non annulés + travaux restants des OR.
 * Exemple : samedi 08:00-14:00, 3 mécaniciens → 3 × 360 × 0,85 = 918 min (15 h 18).
 */
export function computeCapacity(input: ComputeCapacityInput): CapacityResult {
  const { window } = input;
  const blocks = input.blocks ?? [];
  const siteBlocks = blocks.filter((b) => b.bayId === null && b.membershipId === null);

  let availableMinutes = 0;
  let mechanicsPresent = 0;
  for (const mechanicId of input.mechanicIds) {
    let minutes = minutesBetween(window.start, window.end);
    for (const block of [...siteBlocks, ...blocks.filter((b) => b.membershipId === mechanicId)]) {
      if (overlaps(window.start, window.end, block.startsAt, block.endsAt)) {
        minutes -= clippedMinutes(block.startsAt, block.endsAt, window);
      }
    }
    minutes = Math.max(0, minutes);
    if (minutes > 0) mechanicsPresent += 1;
    availableMinutes += minutes;
  }

  const capacityMinutes = Math.round(availableMinutes * input.productivityRate);

  let loadMinutes = 0;
  let appointmentsCount = 0;
  for (const appointment of input.appointments) {
    if (!BLOCKING_STATUSES.includes(appointment.status)) continue;
    if (!overlaps(window.start, window.end, appointment.startsAt, appointment.endsAt)) continue;
    loadMinutes += clippedMinutes(appointment.startsAt, appointment.endsAt, window);
    appointmentsCount += 1;
  }
  for (const order of input.occupyingOrders ?? []) {
    loadMinutes += Math.max(0, order.remainingMinutes ?? 0);
  }

  const maxAppointments = input.maxAppointmentsPerHalfDay ?? Math.max(1, input.activeBayCount * 2);

  return {
    date: window.date,
    halfDay: window.halfDay,
    capacityMinutes,
    loadMinutes: Math.round(loadMinutes),
    appointmentsCount,
    maxAppointments,
    mechanicsPresent,
  };
}

export type CapacityRefusal = "CAPACITY_EXCEEDED" | "MAX_APPOINTMENTS";

/** RG-M03-05 — un RDV est refusé si charge + durée > capacité, ou si le nombre de RDV atteint le plafond. */
export function canAcceptAppointment(
  capacity: CapacityResult,
  durationMinutes: number,
): { ok: true } | { ok: false; reason: CapacityRefusal } {
  if (capacity.appointmentsCount >= capacity.maxAppointments) {
    return { ok: false, reason: "MAX_APPOINTMENTS" };
  }
  if (capacity.loadMinutes + durationMinutes > capacity.capacityMinutes) {
    return { ok: false, reason: "CAPACITY_EXCEEDED" };
  }
  return { ok: true };
}

/** Taux d'occupation (0-1) : heures réservées / heures ouvertes (US-M03-11, vue Semaine). */
export function occupancyRate(capacity: CapacityResult): number {
  if (capacity.capacityMinutes <= 0) return capacity.loadMinutes > 0 ? 1 : 0;
  return Math.min(1, capacity.loadMinutes / capacity.capacityMinutes);
}
