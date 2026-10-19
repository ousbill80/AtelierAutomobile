// RG-M10-16 — plafonds anti-spam par `recipientKey` (A9 : par adresse, tous types de
// relances non transactionnelles confondus, y compris RECOMMENDED_WORK et les créances M09).

export interface AntiSpamCountsInput {
  /** Messages non transactionnels déjà envoyés/en file aujourd'hui pour ce `recipientKey`. */
  sentOrQueuedToday: number;
  /** Idem sur les 7 derniers jours glissants. */
  sentOrQueuedLast7Days: number;
  maxPerDay: number;
  maxPerWeek: number;
}

export function antiSpamAllows(input: AntiSpamCountsInput): boolean {
  return (
    input.sentOrQueuedToday < input.maxPerDay && input.sentOrQueuedLast7Days < input.maxPerWeek
  );
}

/** Après un report (plafond atteint), une relance différée 3 fois passe `SKIPPED`. */
export function deferOutcome(deferCountAfterThis: number): "SNOOZED" | "SKIPPED" {
  return deferCountAfterThis >= 3 ? "SKIPPED" : "SNOOZED";
}
