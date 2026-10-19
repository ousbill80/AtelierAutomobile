// US-M03-05 / M17 — suggestion de créneau à partir d'un message libre (« oui samedi matin »,
// « demain après-midi »). Heuristique déterministe en attendant le service IA (M17) : elle
// ne fait que filtrer les créneaux libres ; l'humain accepte ou change la proposition.
import { addDaysToKey, localDateKey, localMinutes, weekdayKeyOf, zonedInstant } from "./time";
import type { HalfDay } from "./types";

const DAY_WORDS: Record<string, string> = {
  lundi: "mon",
  mardi: "tue",
  mercredi: "wed",
  jeudi: "thu",
  vendredi: "fri",
  samedi: "sat",
  dimanche: "sun",
};

export interface SlotPreference {
  /** Jour civil visé (`yyyy-MM-dd`), si le texte en désigne un. */
  date?: string;
  halfDay?: HalfDay;
  /** Libellé lisible de l'intention détectée (« samedi matin »). */
  label: string;
}

export function parsePreferredSlotText(text: string, now: Date, timeZone: string): SlotPreference {
  const value = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const today = localDateKey(now, timeZone);
  const preference: SlotPreference = { label: "" };
  const parts: string[] = [];
  if (/apres[- ]?demain/.test(value)) {
    preference.date = addDaysToKey(today, 2);
    parts.push("après-demain");
  } else if (/\bdemain\b/.test(value)) {
    preference.date = addDaysToKey(today, 1);
    parts.push("demain");
  } else if (/aujourd'?hui|ce matin|cet apres/.test(value)) {
    preference.date = today;
    parts.push("aujourd'hui");
  } else {
    for (const [word, key] of Object.entries(DAY_WORDS)) {
      if (new RegExp(`\\b${word}\\b`).test(value)) {
        // Prochaine occurrence (aujourd'hui exclu si l'après-midi est déjà entamé).
        for (let i = 0; i < 8; i++) {
          const candidate = addDaysToKey(today, i);
          if (weekdayKeyOf(candidate) !== key) continue;
          if (i === 0 && localMinutes(now, timeZone) >= 12 * 60) continue;
          preference.date = candidate;
          break;
        }
        parts.push(word);
        break;
      }
    }
  }
  if (/matin|matinee/.test(value)) {
    preference.halfDay = "AM";
    parts.push("matin");
  } else if (/apres[- ]?midi|aprem|soir/.test(value)) {
    preference.halfDay = "PM";
    parts.push("après-midi");
  }
  preference.label = parts.join(" ");
  return preference;
}

/**
 * RG-M03-08 : un message transactionnel n'est pas envoyé entre 22:00 et 07:00 (heure du
 * site) ; il part à 07:00. Renvoie l'instant d'envoi.
 */
export function transactionalSendTime(now: Date, timeZone: string): Date {
  const minutes = localMinutes(now, timeZone);
  if (minutes >= 7 * 60 && minutes < 22 * 60) return now;
  const today = localDateKey(now, timeZone);
  const day = minutes >= 22 * 60 ? addDaysToKey(today, 1) : today;
  return zonedInstant(day, 7 * 60, timeZone);
}
