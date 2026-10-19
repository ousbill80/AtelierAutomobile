import { DomainError } from "../errors";

/** Clés acceptées pour `Site.openingHours` (M15 RG-M15-07). */
export const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

const WEEKDAY_KEY_SET: ReadonlySet<string> = new Set(WEEKDAY_KEYS);

/** `{ mon: [["07:30","12:00"],["13:00","18:00"]], …, sun: [] }` (schéma `Site.openingHours`). */
export type OpeningHours = Partial<Record<WeekdayKey, ReadonlyArray<readonly [string, string]>>>;

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string, context: Record<string, unknown>): number {
  const match = TIME_FORMAT.exec(time);
  if (!match) {
    throw new DomainError(
      "opening_hours.invalid_time",
      `Horaire invalide « ${time} » : utilisez le format HH:MM (ex. 07:30).`,
      { ...context, time },
    );
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * RG-M15-07 — valide les horaires d'un site : clés de jour connues, plages non chevauchantes,
 * fin > début, pas inférieur à 15 minutes interdit. Lève `DomainError` au premier problème trouvé.
 */
export function validateOpeningHours(openingHours: OpeningHours): void {
  for (const day of Object.keys(openingHours)) {
    if (!WEEKDAY_KEY_SET.has(day)) {
      throw new DomainError(
        "opening_hours.unknown_day",
        `Jour inconnu dans les horaires : « ${day} » (attendu : ${WEEKDAY_KEYS.join(", ")}).`,
        { day },
      );
    }

    const ranges = openingHours[day as WeekdayKey] ?? [];
    const intervals: Array<{ start: number; end: number }> = [];

    for (const [start, end] of ranges) {
      const startMinutes = toMinutes(start, { day });
      const endMinutes = toMinutes(end, { day });

      if (endMinutes <= startMinutes) {
        throw new DomainError(
          "opening_hours.end_before_start",
          `Horaires du ${day} : l'heure de fin (${end}) doit être après l'heure de début (${start}).`,
          { day, start, end },
        );
      }
      if ((endMinutes - startMinutes) % 15 !== 0) {
        throw new DomainError(
          "opening_hours.step_not_15_minutes",
          `Horaires du ${day} : la plage ${start}–${end} doit être un multiple de 15 minutes.`,
          { day, start, end },
        );
      }
      intervals.push({ start: startMinutes, end: endMinutes });
    }

    intervals.sort((a, b) => a.start - b.start);
    for (let i = 1; i < intervals.length; i++) {
      if (intervals[i]!.start < intervals[i - 1]!.end) {
        throw new DomainError(
          "opening_hours.overlapping_ranges",
          `Horaires du ${day} : les plages se chevauchent.`,
          { day },
        );
      }
    }
  }
}
