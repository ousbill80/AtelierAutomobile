// Génération des jours fériés ivoiriens — M15 RG-M15-08 (PRD : core/calendar/ci-holidays.ts).
// Fonctions pures, testées (02-modele-donnees.md / M15 §12) : aucune horloge système directe,
// l'année est toujours fournie par l'appelant (job `holidays.seed` ou procédure manuelle).

export interface CivilDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export interface GeneratedHoliday {
  date: CivilDate;
  name: string;
  /** Fête religieuse à date variable, à confirmer par le gérant (RG-M15-08). */
  isEstimated: boolean;
}

/**
 * Dimanche de Pâques (calendrier grégorien), algorithme de Meeus/Jones/Butcher.
 * Vérifié contre le PRD : 2027 → 28/03 (donc Lundi de Pâques 29/03, Ascension 06/05,
 * Lundi de Pentecôte 17/05, M15 §12).
 */
export function computeEasterSunday(year: number): CivilDate {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function addDaysToCivilDate(date: CivilDate, days: number): CivilDate {
  // UTC midi pour éviter tout effet de fuseau horaire sur l'arithmétique de dates.
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
  utc.setUTCDate(utc.getUTCDate() + days);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Les 10 jours fériés fixes ou calculables (Pâques) — toujours certains, jamais `isEstimated`. */
export function getFixedHolidays(year: number): GeneratedHoliday[] {
  const easter = computeEasterSunday(year);
  return [
    { date: { year, month: 1, day: 1 }, name: "Jour de l'An", isEstimated: false },
    {
      date: addDaysToCivilDate(easter, 1),
      name: "Lundi de Pâques",
      isEstimated: false,
    },
    { date: { year, month: 5, day: 1 }, name: "Fête du Travail", isEstimated: false },
    {
      date: addDaysToCivilDate(easter, 39),
      name: "Ascension",
      isEstimated: false,
    },
    {
      date: addDaysToCivilDate(easter, 50),
      name: "Lundi de Pentecôte",
      isEstimated: false,
    },
    { date: { year, month: 8, day: 7 }, name: "Fête de l'Indépendance", isEstimated: false },
    { date: { year, month: 8, day: 15 }, name: "Assomption", isEstimated: false },
    { date: { year, month: 11, day: 1 }, name: "Toussaint", isEstimated: false },
    {
      date: { year, month: 11, day: 15 },
      name: "Anniversaire de la mort de Félix Houphouët-Boigny",
      isEstimated: false,
    },
    { date: { year, month: 12, day: 25 }, name: "Noël", isEstimated: false },
  ];
}

// ───────────── Fêtes musulmanes à date estimée (RG-M15-08) ─────────────
// Calendrier hégirien tabulaire (civil, non observationnel) — Fliegel & Van Flandern pour la
// conversion JJ ↔ grégorien. Les dates réelles dépendent de l'observation du croissant lunaire :
// marquées `isEstimated = true`, à confirmer par le gérant (notification J-7, cf. RG-M15-08).

function islamicToJulianDay(hijriYear: number, hijriMonth: number, hijriDay: number): number {
  return (
    hijriDay +
    Math.ceil(29.5 * (hijriMonth - 1)) +
    (hijriYear - 1) * 354 +
    Math.floor((3 + 11 * hijriYear) / 30) +
    1948440
  );
}

function julianDayToGregorian(jdn: number): CivilDate {
  let l = jdn + 68569;
  const n = Math.floor((4 * l) / 146097);
  l = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l + 1)) / 1461001);
  l = l - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l) / 2447);
  const day = l - Math.floor((2447 * j) / 80);
  l = Math.floor(j / 11);
  const month = j + 2 - 12 * l;
  const year = 100 * (n - 49) + i + l;
  return { year, month, day };
}

/** Année hégirienne approximative au début de l'année grégorienne donnée (point de départ de recherche). */
function approxHijriYear(gregorianYear: number): number {
  return Math.floor((gregorianYear - 622) * (33 / 32));
}

/**
 * Cherche, parmi les années hégiriennes voisines, celle dont le jour (hijriMonth, hijriDay)
 * retombe dans `gregorianYear`. Retourne `null` si aucune occurrence (ne devrait pas arriver
 * en pratique, une fête hégirienne retombant dans chaque année grégorienne).
 */
function estimateIslamicFeastDate(
  hijriMonth: number,
  hijriDay: number,
  gregorianYear: number,
): CivilDate | null {
  const approx = approxHijriYear(gregorianYear);
  for (const hijriYear of [approx - 1, approx, approx + 1, approx + 2]) {
    const jdn = islamicToJulianDay(hijriYear, hijriMonth, hijriDay);
    const gregorian = julianDayToGregorian(jdn);
    if (gregorian.year === gregorianYear) {
      return gregorian;
    }
  }
  return null;
}

const ESTIMATED_ISLAMIC_FEASTS: ReadonlyArray<{
  name: string;
  hijriMonth: number;
  hijriDay: number;
}> = [
  { name: "Lendemain de la Nuit du Destin", hijriMonth: 9, hijriDay: 28 },
  { name: "Aïd el-Fitr", hijriMonth: 10, hijriDay: 1 },
  { name: "Tabaski (Aïd el-Kébir)", hijriMonth: 12, hijriDay: 10 },
  { name: "Maouloud", hijriMonth: 3, hijriDay: 12 },
];

/** Les 4 fêtes musulmanes à date variable, toutes `isEstimated = true` (RG-M15-08). */
export function getEstimatedIslamicHolidays(year: number): GeneratedHoliday[] {
  const results: GeneratedHoliday[] = [];
  for (const feast of ESTIMATED_ISLAMIC_FEASTS) {
    const date = estimateIslamicFeastDate(feast.hijriMonth, feast.hijriDay, year);
    if (date) {
      results.push({ date, name: feast.name, isEstimated: true });
    }
  }
  return results;
}

/** Liste complète des jours fériés ivoiriens proposés pour une année (fixes + estimés). */
export function generateCiHolidays(year: number): GeneratedHoliday[] {
  return [...getFixedHolidays(year), ...getEstimatedIslamicHolidays(year)];
}

export function civilDateToUtcDate(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}
