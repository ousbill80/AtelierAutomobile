// RG-M03-12 — attribution des relances : un RDV créé avec `reminderId` explicite le garde ;
// sinon, un RDV créé dans les 14 jours suivant l'envoi d'une relance VT/révision au même
// client pour le même véhicule lui est attribué automatiquement (KPI M12 §"Clients revenus
// après un rappel").

export interface RecentReminderLike {
  id: string;
  vehicleId: string | null;
  customerId: string;
  type: string;
  sentAt: Date;
}

export interface AttributeReminderInput {
  explicitReminderId?: string | null;
  customerId: string;
  vehicleId?: string | null;
  createdAt: Date;
  recentReminders: readonly RecentReminderLike[];
  windowDays?: number;
  eligibleTypes?: readonly string[];
}

const DEFAULT_ELIGIBLE_TYPES = ["INSPECTION", "SERVICE"];

export function attributeReminder(input: AttributeReminderInput): string | null {
  if (input.explicitReminderId) return input.explicitReminderId;

  const windowMs = (input.windowDays ?? 14) * 24 * 60 * 60 * 1000;
  const eligibleTypes = input.eligibleTypes ?? DEFAULT_ELIGIBLE_TYPES;

  const candidates = input.recentReminders.filter((reminder) => {
    if (!eligibleTypes.includes(reminder.type)) return false;
    const sameTarget = input.vehicleId
      ? reminder.vehicleId === input.vehicleId
      : reminder.customerId === input.customerId;
    if (!sameTarget) return false;
    const age = input.createdAt.getTime() - reminder.sentAt.getTime();
    return age >= 0 && age <= windowMs;
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  return candidates[0]!.id;
}
