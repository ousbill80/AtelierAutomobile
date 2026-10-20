// Utilitaires de dates des rapports (UTC, sans `new Date()` implicite : l'appelant fournit
// toujours l'instant de référence).
import { addMonthsUtc } from "../repairOrders/warranty";

const MS_PER_DAY = 86_400_000;

/** Même instant `months` mois plus tard (jour borné à la fin du mois, via M04). */
export function shiftMonths(date: Date, months: number): Date {
  const timeOfDay = date.getTime() % MS_PER_DAY;
  return new Date(addMonthsUtc(date, months).getTime() + timeOfDay);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `yyyy-MM-dd` → `dd/MM/yyyy` (affichage). */
export function frenchDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
