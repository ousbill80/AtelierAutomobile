import { addDays } from "date-fns";
import type { HolidayLike } from "../calendar";

/**
 * RG-M10-10 — jours fériés chrétiens mobiles, calculés à partir de Pâques (algorithme de Gauss /
 * Meeus-Jones-Butcher, calendrier grégorien). Utilisé par le seed de `Holiday` (M15, arbitrage A1) :
 * ce module ne fait que le calcul pur, la persistance appartient à M15.
 */
export interface EasterBasedHolidays {
  easterSunday: Date;
  /** Lundi de Pâques (+1 j). */
  easterMonday: Date;
  /** Ascension (+39 j). */
  ascension: Date;
  /** Lundi de Pentecôte (+50 j). */
  pentecostMonday: Date;
}

/** Date de Pâques (dimanche) pour `year`, en UTC minuit. */
export function computeEasterSunday(year: number): Date {
  // Algorithme anonyme grégorien (Meeus/Jones/Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** RG-M10-10 — fêtes chrétiennes mobiles de `year`, déduites de Pâques. */
export function easterBasedHolidays(year: number): EasterBasedHolidays {
  const easterSunday = computeEasterSunday(year);
  return {
    easterSunday,
    easterMonday: addDays(easterSunday, 1),
    ascension: addDays(easterSunday, 39),
    pentecostMonday: addDays(easterSunday, 50),
  };
}

/** RG-M10-10 — jours fériés fixes ivoiriens de `year` (hors fêtes religieuses mobiles). */
export function ivorianFixedHolidays(year: number): { date: Date; label: string }[] {
  return [
    { date: new Date(Date.UTC(year, 0, 1)), label: "Jour de l'an" },
    { date: new Date(Date.UTC(year, 4, 1)), label: "Fête du travail" },
    { date: new Date(Date.UTC(year, 7, 7)), label: "Fête nationale" },
    { date: new Date(Date.UTC(year, 7, 15)), label: "Assomption" },
    { date: new Date(Date.UTC(year, 10, 1)), label: "Toussaint" },
    { date: new Date(Date.UTC(year, 10, 15)), label: "Journée nationale de la paix" },
    { date: new Date(Date.UTC(year, 11, 25)), label: "Noël" },
  ];
}

/**
 * RG-M10-10 — jours fériés chrétiens de `year`, fixes + mobiles, prêts à être semés dans `Holiday`
 * (M15). Les fêtes musulmanes ne sont pas calculables par formule : elles restent une saisie
 * annuelle marquée « estimée » (hors scope de cette fonction pure).
 */
export function christianHolidaysOfYear(year: number): HolidayLike[] {
  const mobile = easterBasedHolidays(year);
  const fixed = ivorianFixedHolidays(year);
  return [
    ...fixed.map((h) => ({ date: h.date, siteId: null })),
    { date: mobile.easterMonday, siteId: null },
    { date: mobile.ascension, siteId: null },
    { date: mobile.pentecostMonday, siteId: null },
  ];
}
