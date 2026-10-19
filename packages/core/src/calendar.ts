import { formatInTimeZone } from "date-fns-tz";
import type { Clock } from "./clock";
import { DomainError } from "./errors";

/** Jour de la semaine au sens JS : 0 = dimanche … 6 = samedi. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Fermeture hebdomadaire par défaut : dimanche uniquement (01-architecture-technique.md §7 ;
 * confirmé par les exemples métier de M03-rendez-vous-planning.md, qui traitent le samedi
 * comme un jour ouvré normal et le dimanche comme une fermeture — ex. lignes 22, 28, 99).
 * Un site peut avoir d'autres horaires (M15) ; ce module ne connaît que la règle par défaut.
 */
export const DEFAULT_WEEKLY_CLOSURE: readonly Weekday[] = [0];

/** Forme minimale d'un jour férié, indépendante du modèle Prisma `Holiday`. */
export interface HolidayLike {
  /** Date du jour férié (comparée en jour civil, sans heure). */
  date: Date;
  /** `null` = jour férié pour tous les sites de l'organisation. */
  siteId: string | null;
}

function toDateKey(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "yyyy-MM-dd");
}

/** Affichage métier des dates, toujours `dd/MM/yyyy` dans le fuseau de l'organisation (01-architecture-technique.md §7). */
export function formatDate(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "dd/MM/yyyy");
}

/** Vrai si `date` correspond à un jour férié applicable au site (global ou spécifique à `siteId`). */
export function isHoliday(
  date: Date,
  siteId: string | null,
  holidays: readonly HolidayLike[],
  timeZone: string,
): boolean {
  const key = toDateKey(date, timeZone);
  return holidays.some(
    (holiday) =>
      (holiday.siteId === null || holiday.siteId === siteId) &&
      toDateKey(holiday.date, timeZone) === key,
  );
}

export interface BusinessDayOptions {
  siteId?: string | null;
  holidays?: readonly HolidayLike[];
  /** Jours de fermeture hebdomadaire ; défaut : {@link DEFAULT_WEEKLY_CLOSURE} (dimanche). */
  weeklyClosure?: readonly Weekday[];
}

/** Vrai si `date` est un jour ouvré : ni fermeture hebdomadaire, ni jour férié. */
export function isBusinessDay(
  date: Date,
  timeZone: string,
  options: BusinessDayOptions = {},
): boolean {
  const weeklyClosure = options.weeklyClosure ?? DEFAULT_WEEKLY_CLOSURE;
  const weekday = Number(formatInTimeZone(date, timeZone, "i")) % 7;
  if (weeklyClosure.includes(weekday as Weekday)) {
    return false;
  }
  return !isHoliday(date, options.siteId ?? null, options.holidays ?? [], timeZone);
}

/** Ajoute `days` jours ouvrés à `date` (ex. relance VT « J-30 ouvrés »). `days` doit être un entier positif. */
export function addBusinessDays(
  date: Date,
  days: number,
  timeZone: string,
  options: BusinessDayOptions = {},
): Date {
  if (!Number.isInteger(days) || days <= 0) {
    throw new DomainError(
      "calendar.invalid_business_days",
      "Le nombre de jours ouvrés doit être un entier positif.",
      { days },
    );
  }

  let remaining = days;
  let current = date;
  while (remaining > 0) {
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    if (isBusinessDay(current, timeZone, options)) {
      remaining -= 1;
    }
  }
  return current;
}

/** Soustrait `days` jours ouvrés à `date` (ex. RG-M10-09 : repli d'un palier avant échéance). */
export function subBusinessDays(
  date: Date,
  days: number,
  timeZone: string,
  options: BusinessDayOptions = {},
): Date {
  if (!Number.isInteger(days) || days <= 0) {
    throw new DomainError(
      "calendar.invalid_business_days",
      "Le nombre de jours ouvrés doit être un entier positif.",
      { days },
    );
  }

  let remaining = days;
  let current = date;
  while (remaining > 0) {
    current = new Date(current.getTime() - 24 * 60 * 60 * 1000);
    if (isBusinessDay(current, timeZone, options)) {
      remaining -= 1;
    }
  }
  return current;
}

/** Date courante formatée pour affichage métier, à partir d'une horloge injectable (jamais `new Date()` direct). */
export function today(clock: Clock, timeZone: string): string {
  return formatDate(clock.now(), timeZone);
}
