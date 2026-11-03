// M10 §7.2 — vue « calendrier mensuel » de l'écran Échéances : grille du mois (semaines du
// lundi au dimanche), bornes de requête et tonalité de chaque jour. Dates civiles en chaînes
// `YYYY-MM-DD` / `YYYY-MM` (dates métier `@db.Date`, calculs en UTC) ; « aujourd'hui » est
// toujours fourni par l'appelant (horloge injectable), jamais lu ici.

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Seuils de l'écran Échéances : relance client sous 30 j, préparation atelier sous 60 j. */
export const DUE_CLIENT_DAYS = 30;
export const DUE_WORKSHOP_DAYS = 60;

export type DueDayTone = "EXPIRED" | "CLIENT" | "WORKSHOP" | "LATER";

export interface MonthGrid {
  month: string;
  /** Semaines de 7 cases (lundi → dimanche) ; `null` pour les jours hors du mois. */
  weeks: (string | null)[][];
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const match = MONTH_RE.exec(month);
  const monthIndex = match ? Number(match[2]) - 1 : -1;
  if (!match || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Mois invalide : « ${month} » (format attendu AAAA-MM).`);
  }
  return { year: Number(match[1]), monthIndex };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(day: string): Date {
  if (!DAY_RE.test(day)) throw new Error(`Date invalide : « ${day} » (format attendu AAAA-MM-JJ).`);
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || isoDay(date) !== day) {
    throw new Error(`Date invalide : « ${day} ».`);
  }
  return date;
}

/** Mois `YYYY-MM` d'une date civile `YYYY-MM-DD`. */
export function monthOfDay(day: string): string {
  return isoDay(parseDay(day)).slice(0, 7);
}

/** Décale un mois `YYYY-MM` de `delta` mois (négatif pour reculer). */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIndex } = parseMonth(month);
  return isoDay(new Date(Date.UTC(year, monthIndex + delta, 1))).slice(0, 7);
}

/** Bornes UTC du mois : `from` inclus, `to` exclu (premier jour du mois suivant). */
export function monthRange(month: string): { from: Date; to: Date } {
  const { year, monthIndex } = parseMonth(month);
  return {
    from: new Date(Date.UTC(year, monthIndex, 1)),
    to: new Date(Date.UTC(year, monthIndex + 1, 1)),
  };
}

/** Bornes UTC d'un jour civil : `from` inclus, `to` exclu. */
export function dayRange(day: string): { from: Date; to: Date } {
  const from = parseDay(day);
  return { from, to: new Date(from.getTime() + MS_PER_DAY) };
}

/** Grille du mois, semaines commençant le lundi (usage ivoirien et français). */
export function monthGrid(month: string): MonthGrid {
  const { from, to } = monthRange(month);
  const leading = (from.getUTCDay() + 6) % 7; // lundi = 0 … dimanche = 6
  const cells: (string | null)[] = Array.from({ length: leading }, () => null);
  for (let t = from.getTime(); t < to.getTime(); t += MS_PER_DAY) {
    cells.push(isoDay(new Date(t)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { month, weeks };
}

/** Compte les échéances par jour civil (`YYYY-MM-DD`), dates nulles ignorées. */
export function countByDay(dates: readonly (Date | null | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const date of dates) {
    if (!date) continue;
    const key = isoDay(date);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Tonalité d'un jour d'échéance par rapport à aujourd'hui : expirée (avant aujourd'hui),
 * relance client (aujourd'hui → J+30), préparation atelier (J+31 → J+60), plus tard.
 */
export function dueDayTone(day: string, today: string): DueDayTone {
  const diff = Math.round((parseDay(day).getTime() - parseDay(today).getTime()) / MS_PER_DAY);
  if (diff < 0) return "EXPIRED";
  if (diff <= DUE_CLIENT_DAYS) return "CLIENT";
  if (diff <= DUE_WORKSHOP_DAYS) return "WORKSHOP";
  return "LATER";
}
