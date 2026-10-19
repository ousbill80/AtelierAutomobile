// RG-M10-09 — créneau d'envoi (`nextSendSlot`).
import {
  addBusinessDays,
  isBusinessDay,
  subBusinessDays,
  type HolidayLike,
  type Weekday,
} from "../calendar";
import { isWithinSendWindow } from "../messaging/sendWindow";

export interface SendWindowLike {
  /** Jours ouvrés autorisés, convention ISO 1=lundi … 6=samedi, 0=dimanche. */
  days: readonly number[];
  from: string;
  to: string;
  preferredTime: string;
}

export interface NextSendSlotInput {
  /** Date cible du palier (`targetDate`) ou plancher d'espacement (`pickStep().notBefore`). */
  target: Date;
  /** Signe du décalage du palier (`step.offsetDays`) : décide du sens du repli (RG-M10-09). */
  offsetDays: number;
  sendWindow: SendWindowLike;
  /** `step.sendAt`, sinon `sendWindow.preferredTime`. */
  sendAt?: string | null;
  holidays?: readonly HolidayLike[];
  siteId?: string | null;
  timeZone: string;
  /** Horloge injectable : décide si l'heure cible est déjà passée. */
  now: Date;
}

const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

function weeklyClosureOf(allowedDays: readonly number[]): Weekday[] {
  return ALL_WEEKDAYS.filter((d) => !allowedDays.includes(d));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Même convention que `messaging/sendWindow.ts` : l'organisation par défaut est
 * `Africa/Abidjan` (UTC+0, pas d'heure d'été), donc une heure locale "HH:mm" peut être
 * composée directement avec la date civile sans conversion de fuseau.
 */
function atLocalTime(day: Date, time: string): Date {
  return new Date(`${dayKey(day)}T${time}:00`);
}

export function nextSendSlot(input: NextSendSlotInput): Date {
  const {
    target,
    offsetDays,
    sendWindow,
    sendAt,
    holidays = [],
    siteId = null,
    timeZone,
    now,
  } = input;
  const options = { siteId, holidays, weeklyClosure: weeklyClosureOf(sendWindow.days) };

  let day = target;
  if (!isBusinessDay(day, timeZone, options)) {
    if (offsetDays < 0) {
      const previous = subBusinessDays(day, 1, timeZone, options);
      const todayKey = dayKey(now);
      day = dayKey(previous) >= todayKey ? previous : addBusinessDays(day, 1, timeZone, options);
    } else {
      day = addBusinessDays(day, 1, timeZone, options);
    }
  }

  const timeStr = sendAt ?? sendWindow.preferredTime;
  let slot = atLocalTime(day, timeStr);

  if (slot.getTime() < now.getTime()) {
    const sameDay = dayKey(slot) === dayKey(now);
    if (
      sameDay &&
      isWithinSendWindow(now, timeZone, { from: sendWindow.from, to: sendWindow.to })
    ) {
      slot = now;
    } else {
      const nextDay = addBusinessDays(now, 1, timeZone, options);
      slot = atLocalTime(nextDay, sendWindow.preferredTime);
    }
  }

  return slot;
}
