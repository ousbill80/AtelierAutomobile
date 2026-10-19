import { formatInTimeZone } from "date-fns-tz";

// RG-M11-02 (4) : filet de sécurité (M10 gère déjà la fenêtre d'envoi en amont).

export interface SendWindow {
  from: string; // "07:00"
  to: string; // "21:00"
}

function minutesOfDay(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isWithinSendWindow(date: Date, timeZone: string, window: SendWindow): boolean {
  const localTime = formatInTimeZone(date, timeZone, "HH:mm");
  const current = minutesOfDay(localTime);
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  if (from <= to) {
    return current >= from && current < to;
  }
  // fenêtre traversant minuit (non attendu ici, from < to en pratique, mais couvert par sûreté)
  return current >= from || current < to;
}

/** Prochain 08:00 local (lendemain si l'heure actuelle est déjà passée 08:00). */
export function nextSendWindowStart(date: Date, timeZone: string): Date {
  const localDateStr = formatInTimeZone(date, timeZone, "yyyy-MM-dd");
  const localTimeStr = formatInTimeZone(date, timeZone, "HH:mm");
  const sameDayAt8 = new Date(`${localDateStr}T08:00:00`);
  if (minutesOfDay(localTimeStr) < minutesOfDay("08:00")) {
    return sameDayAt8;
  }
  return new Date(sameDayAt8.getTime() + 24 * 60 * 60 * 1000);
}
