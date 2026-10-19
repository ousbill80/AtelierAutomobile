// RG-M03-07 — créneaux exposés au portail / à l'assistant « Trouver un créneau ».
import { formatInTimeZone } from "date-fns-tz";
import { isHoliday, type HolidayLike } from "../calendar";
import { WEEKDAY_KEYS, type OpeningHours, type WeekdayKey } from "../organization/opening-hours";
import { detectConflicts, type OccupancyLike } from "./conflicts";

export type HalfDay = "AM" | "PM";

/** Clé stable `"yyyy-MM-dd:AM"` pour indexer une capacité de demi-journée. */
export function halfDayKey(date: string, halfDay: HalfDay): string {
  return `${date}:${halfDay}`;
}

export interface HalfDayCapacity {
  capacityMinutes: number;
  loadMinutes: number;
}

export interface AvailableSlotsInput {
  /** Horodatage de référence (horloge injectable côté appelant, jamais `new Date()` direct). */
  from: Date;
  /** Horizon en jours civils, ≤ 31 (RG-M03-07). */
  horizonDays: number;
  stepMinutes: number;
  durationMinutes: number;
  timeZone: string;
  openingHours: OpeningHours;
  holidays?: readonly HolidayLike[];
  siteId?: string | null;
  minLeadHours: number;
  /** Maximum de créneaux montrés par demi-journée, répartis uniformément (défaut 6). */
  maxSlotsPerHalfDay?: number;
  /** Heure séparant matin/après-midi pour le regroupement d'affichage (défaut "13:00"). */
  middayBoundary?: string;
  /** RDV, blocages et OR en cours déjà en place. */
  occupancies: readonly OccupancyLike[];
  /** Ponts compatibles avec le type demandé ; `null`/absent = aucun pont requis. */
  compatibleBayIds?: readonly string[] | null;
  autoAssignBay: boolean;
  /** Capacité de chaque demi-journée (calculée en amont par l'appelant, cf. `computeCapacity`). */
  halfDayCapacity?: ReadonlyMap<string, HalfDayCapacity>;
}

export interface AvailableSlot {
  startsAt: Date;
  bayId: string | null;
}

export interface AvailableSlotsDay {
  date: string;
  halfDay: HalfDay;
  slots: AvailableSlot[];
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

function dayAt(baseDate: Date, dayOffset: number, timeZone: string): string {
  const key = formatInTimeZone(baseDate, timeZone, "yyyy-MM-dd");
  const [y, m, d] = key.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, m! - 1, d! + dayOffset, 12));
  return formatInTimeZone(noonUtc, timeZone, "yyyy-MM-dd");
}

/** Reconstruit un instant UTC à partir d'un jour civil local + minutes depuis minuit local. */
function slotStartAt(dateKey: string, minutesFromMidnight: number, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Point de départ à midi UTC ce jour-là (toujours dans le même jour civil quel que soit le
  // fuseau), puis ajustement par la différence entre l'heure locale obtenue et celle voulue.
  const noonUtc = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const noonLocalMinutes = toMinutes(formatInTimeZone(noonUtc, timeZone, "HH:mm"));
  const deltaMinutes = minutesFromMidnight - noonLocalMinutes;
  return new Date(noonUtc.getTime() + deltaMinutes * 60_000);
}

function evenlySample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return items.length > 0 ? [items[0]!] : [];
  const result: T[] = [];
  const lastIndex = items.length - 1;
  for (let i = 0; i < max; i++) {
    const index = Math.round((i * lastIndex) / (max - 1));
    const item = items[index]!;
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

export function availableSlots(input: AvailableSlotsInput): AvailableSlotsDay[] {
  const maxSlotsPerHalfDay = input.maxSlotsPerHalfDay ?? 6;
  const middayBoundaryMinutes = toMinutes(input.middayBoundary ?? "13:00");
  const minLeadMs = input.minLeadHours * 60 * 60 * 1000;
  const earliestStart = new Date(input.from.getTime() + minLeadMs);
  const compatibleBayIds = input.compatibleBayIds ?? null;

  const byHalfDay = new Map<string, { date: string; halfDay: HalfDay; slots: AvailableSlot[] }>();

  for (let dayOffset = 0; dayOffset < input.horizonDays; dayOffset++) {
    const dateKey = dayAt(input.from, dayOffset, input.timeZone);
    const [y, m, d] = dateKey.split("-").map(Number);
    const noonThisDay = new Date(Date.UTC(y!, m! - 1, d!, 12));
    if (isHoliday(noonThisDay, input.siteId ?? null, input.holidays ?? [], input.timeZone)) {
      continue;
    }
    const weekdayIso = Number(formatInTimeZone(noonThisDay, input.timeZone, "i"));
    const weekdayKey: WeekdayKey = WEEKDAY_KEYS[weekdayIso - 1]!;
    const ranges = input.openingHours[weekdayKey] ?? [];

    for (const [rangeStart, rangeEnd] of ranges) {
      const rangeStartMinutes = toMinutes(rangeStart);
      const rangeEndMinutes = toMinutes(rangeEnd);
      const firstStep = Math.ceil(rangeStartMinutes / input.stepMinutes) * input.stepMinutes;

      for (
        let t = Math.max(firstStep, rangeStartMinutes);
        t + input.durationMinutes <= rangeEndMinutes;
        t += input.stepMinutes
      ) {
        const startsAt = slotStartAt(dateKey, t, input.timeZone);
        if (startsAt.getTime() < earliestStart.getTime()) continue;
        const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60_000);

        const halfDay: HalfDay = t < middayBoundaryMinutes ? "AM" : "PM";
        const capacity = input.halfDayCapacity?.get(halfDayKey(dateKey, halfDay));
        if (capacity && capacity.loadMinutes + input.durationMinutes > capacity.capacityMinutes) {
          continue;
        }

        let bayId: string | null = null;
        if (input.autoAssignBay) {
          if (!compatibleBayIds || compatibleBayIds.length === 0) continue;
          const freeBay = compatibleBayIds.find(
            (candidateBayId) =>
              detectConflicts({ bayId: candidateBayId, startsAt, endsAt }, input.occupancies) ===
              null,
          );
          if (!freeBay) continue;
          bayId = freeBay;
        }

        const key = halfDayKey(dateKey, halfDay);
        if (!byHalfDay.has(key)) byHalfDay.set(key, { date: dateKey, halfDay, slots: [] });
        byHalfDay.get(key)!.slots.push({ startsAt, bayId });
      }
    }
  }

  return [...byHalfDay.values()]
    .sort((a, b) =>
      a.date === b.date ? a.halfDay.localeCompare(b.halfDay) : a.date.localeCompare(b.date),
    )
    .map((group) => ({
      date: group.date,
      halfDay: group.halfDay,
      slots: evenlySample(group.slots, maxSlotsPerHalfDay),
    }));
}
