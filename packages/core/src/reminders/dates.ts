// Petits utilitaires de dates civiles (jour calendaire, sans heure) partagés par le moteur
// de relances (RG-M10-05 à RG-M10-09). Les ancres de relance sont des dates métier
// (`@db.Date`) : les calculs se font en millisecondes UTC, jamais via `new Date()` direct.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Différence en jours entiers entre deux dates (`a − b`), tronquée vers zéro. */
export function diffDays(a: Date, b: Date): number {
  return Math.trunc((a.getTime() - b.getTime()) / MS_PER_DAY);
}

export function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
