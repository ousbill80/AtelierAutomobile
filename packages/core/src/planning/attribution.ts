// RG-M03-12 — attribution d'un RDV à la relance VT/révision envoyée au même client pour le
// même véhicule dans les 14 jours précédents (KPI M12 « Clients revenus après un rappel »).

export const ATTRIBUTION_WINDOW_DAYS = 14;
const ATTRIBUTABLE_TYPES = new Set(["INSPECTION", "SERVICE"]);

export interface AttributableReminder {
  id: string;
  type: string;
  customerId: string;
  vehicleId: string | null;
  sentAt: Date | null;
}

export function attributeReminder(
  appointment: {
    customerId: string;
    vehicleId: string | null;
    createdAt: Date;
    reminderId?: string | null;
  },
  reminders: readonly AttributableReminder[],
): string | null {
  if (appointment.reminderId) return appointment.reminderId;
  if (!appointment.vehicleId) return null;
  const since = appointment.createdAt.getTime() - ATTRIBUTION_WINDOW_DAYS * 86_400_000;
  const match = reminders
    .filter(
      (r) =>
        ATTRIBUTABLE_TYPES.has(r.type) &&
        r.customerId === appointment.customerId &&
        r.vehicleId === appointment.vehicleId &&
        r.sentAt !== null &&
        r.sentAt.getTime() >= since &&
        r.sentAt.getTime() <= appointment.createdAt.getTime(),
    )
    .sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0];
  return match?.id ?? null;
}
