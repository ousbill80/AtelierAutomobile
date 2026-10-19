import { formatInTimeZone } from "date-fns-tz";
import { instantAt, civilDay, nextCivilDay } from "./opening-hours";

export const TRANSACTIONAL_QUIET_FROM = "22:00";
export const TRANSACTIONAL_QUIET_TO = "07:00";

/**
 * RG-M03-08 — un message transactionnel (confirmation, déplacement, annulation) part
 * immédiatement, sauf entre 22:00 et 07:00 heure locale : il est alors envoyé à 07:00.
 */
export function transactionalSendTime(now: Date, timeZone: string): Date {
  const local = formatInTimeZone(now, timeZone, "HH:mm");
  if (local >= TRANSACTIONAL_QUIET_FROM) {
    const tomorrow = nextCivilDay(now, timeZone);
    return instantAt(civilDay(tomorrow, timeZone), TRANSACTIONAL_QUIET_TO, timeZone);
  }
  if (local < TRANSACTIONAL_QUIET_TO) {
    return instantAt(civilDay(now, timeZone), TRANSACTIONAL_QUIET_TO, timeZone);
  }
  return now;
}

export const REMINDER_J1_TIME = "17:00";
export const REMINDER_J1_EARLY_TIME = "19:00";
export const REMINDER_MIN_LEAD_HOURS = 24;

/**
 * RG-M03-08 — instant du rappel J-1 : la veille à 17:00 (19:00 pour un RDV avant 10:00, à la
 * place de H-2). `null` si le RDV est créé moins de 24 h avant (confirmation seule).
 */
export function computeJ1ReminderTime(input: {
  startsAt: Date;
  createdAt: Date;
  timeZone: string;
}): Date | null {
  if (input.startsAt.getTime() - input.createdAt.getTime() < REMINDER_MIN_LEAD_HOURS * 3_600_000) {
    return null;
  }
  const dayBefore = new Date(
    instantAt(civilDay(input.startsAt, input.timeZone), "12:00", input.timeZone).getTime() -
      24 * 3_600_000,
  );
  const startTime = formatInTimeZone(input.startsAt, input.timeZone, "HH:mm");
  const time = startTime < "10:00" ? REMINDER_J1_EARLY_TIME : REMINDER_J1_TIME;
  return instantAt(civilDay(dayBefore, input.timeZone), time, input.timeZone);
}
