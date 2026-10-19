// RG-M04-10 — promesse de restitution et retard.
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { STATUS_RANK, type RepairOrderStatus } from "./types";

/**
 * Proposition : aujourd'hui 17:00 si la charge estimée est ≤ 4 h et la réception a lieu avant
 * 11:00 (heure locale) ; sinon le lendemain 17:00 (dimanche sauté).
 */
export function suggestPromisedAt(now: Date, timeZone: string, estimatedHours: number): Date {
  const localHour = Number(formatInTimeZone(now, timeZone, "H"));
  const sameDay = estimatedHours <= 4 && localHour < 11;
  const day = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  let target = new Date(`${day}T00:00:00.000Z`);
  if (!sameDay) {
    target = new Date(target.getTime() + 86_400_000);
    if (target.getUTCDay() === 0) target = new Date(target.getTime() + 86_400_000);
  }
  return fromZonedTime(`${target.toISOString().slice(0, 10)}T17:00:00`, timeZone);
}

/** OR en retard : `now > promisedAt` et statut antérieur à READY (hors annulé). */
export function isLate(
  order: { status: RepairOrderStatus; promisedAt: Date | null },
  now: Date,
): boolean {
  if (!order.promisedAt) return false;
  const rank = STATUS_RANK[order.status];
  if (rank < 0 || rank >= STATUS_RANK.READY) return false;
  return now.getTime() > order.promisedAt.getTime();
}
