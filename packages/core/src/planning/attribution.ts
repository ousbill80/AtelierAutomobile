export interface SentReminderLike {
  id: string;
  customerId: string;
  vehicleId: string | null;
  type: string;
  sentAt: Date | null;
}

export interface AttributeReminderInput {
  customerId: string;
  vehicleId: string | null;
  /** Instant de création du RDV. */
  createdAt: Date;
  /** `reminderId` explicite (lien de relance, réponse, création depuis la file). */
  reminderId?: string | null;
  sentReminders: readonly SentReminderLike[];
  windowDays?: number;
  /** Types de relance attribuables ; défaut : VT et révision (RG-M03-12). */
  types?: readonly string[];
}

export const REMINDER_ATTRIBUTION_WINDOW_DAYS = 14;
const DEFAULT_ATTRIBUTABLE_TYPES = ["INSPECTION", "SERVICE"] as const;

/**
 * RG-M03-12 — un RDV est attribué à une relance si `reminderId` est fourni, ou s'il est créé
 * dans les 14 jours suivant l'envoi d'une relance VT/révision au même client pour le même
 * véhicule (la plus récente l'emporte). Renvoie l'identifiant de relance ou `null`.
 */
export function attributeReminder(input: AttributeReminderInput): string | null {
  if (input.reminderId) return input.reminderId;
  const windowMs = (input.windowDays ?? REMINDER_ATTRIBUTION_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const types = input.types ?? DEFAULT_ATTRIBUTABLE_TYPES;
  let best: SentReminderLike | null = null;
  for (const reminder of input.sentReminders) {
    if (!reminder.sentAt) continue;
    if (reminder.customerId !== input.customerId) continue;
    if (!types.includes(reminder.type)) continue;
    if (input.vehicleId && reminder.vehicleId && reminder.vehicleId !== input.vehicleId) continue;
    if (!input.vehicleId && reminder.vehicleId) continue;
    const delta = input.createdAt.getTime() - reminder.sentAt.getTime();
    if (delta < 0 || delta > windowMs) continue;
    if (!best || reminder.sentAt > best.sentAt!) best = reminder;
  }
  return best?.id ?? null;
}
