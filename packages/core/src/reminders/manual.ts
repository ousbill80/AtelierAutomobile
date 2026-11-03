// « Relancer maintenant » (M09 §7, écran Créances) : relance manuelle hors séquence. Pour ne
// pas harceler le client, une seule relance de créance envoyée par période de 20 h, qu'elle
// soit automatique ou manuelle.

export const MANUAL_REMINDER_MIN_GAP_HOURS = 20;

export type ManualReminderCheck =
  | { allowed: true }
  | { allowed: false; reason: "RECENTLY_SENT"; nextAllowedAt: Date }
  | { allowed: false; reason: "ALREADY_PENDING" };

export function checkManualReminder(input: {
  now: Date;
  lastSentAt: Date | null;
  hasPendingDue: boolean;
}): ManualReminderCheck {
  if (input.hasPendingDue) return { allowed: false, reason: "ALREADY_PENDING" };
  if (input.lastSentAt) {
    const nextAllowedAt = new Date(
      input.lastSentAt.getTime() + MANUAL_REMINDER_MIN_GAP_HOURS * 3_600_000,
    );
    if (nextAllowedAt.getTime() > input.now.getTime()) {
      return { allowed: false, reason: "RECENTLY_SENT", nextAllowedAt };
    }
  }
  return { allowed: true };
}
