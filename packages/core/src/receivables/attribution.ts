// RG-M09-14 / A10 — attribution d'un encaissement à la dernière relance ou au dernier appel.

export interface AttributionTouch {
  id: string;
  at: Date;
}

export type AttributionResult =
  | { source: "reminder"; reminderId: string }
  | { source: "call"; collectionNoteId: string }
  | { source: "spontaneous" };

const MS_PER_DAY = 86_400_000;

export function attributePayment(input: {
  receivedAt: Date;
  reminders: AttributionTouch[];
  calls: AttributionTouch[];
  attributionDays?: number;
}): AttributionResult {
  // A10 : une seule règle, celle de M12 (fenêtre de 14 jours par défaut).
  const windowMs = (input.attributionDays ?? 14) * MS_PER_DAY;
  const t = input.receivedAt.getTime();
  const latest = (touches: AttributionTouch[]) =>
    touches
      .filter((x) => x.at.getTime() <= t && t - x.at.getTime() <= windowMs)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const reminder = latest(input.reminders);
  const call = latest(input.calls);
  if (call && (!reminder || call.at.getTime() > reminder.at.getTime())) {
    return { source: "call", collectionNoteId: call.id };
  }
  if (reminder) return { source: "reminder", reminderId: reminder.id };
  return { source: "spontaneous" };
}
