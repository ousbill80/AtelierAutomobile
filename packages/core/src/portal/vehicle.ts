// M14 §4.5 — historique et échéances d'un véhicule (US-M14-07, RG-M14-20) et avis (RG-M14-21).

const DAY_MS = 86_400_000;

export type DeadlineState = "OK" | "SOON" | "OVERDUE" | "UNKNOWN";

/** Seuil du badge « Bientôt » (RG-M14-20). */
export const DEADLINE_SOON_DAYS = 30;

function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}

/**
 * Échéance d'une date métier (`@db.Date`) par rapport au jour courant de l'organisation
 * (`today` : date métier, minuit UTC) : « Bientôt » si ≤ 30 j, « Dépassée » si passée.
 */
export function deadlineStatus(
  due: Date | null | undefined,
  today: Date,
): { state: DeadlineState; daysLeft: number | null } {
  if (!due) return { state: "UNKNOWN", daysLeft: null };
  const daysLeft = dayNumber(due) - dayNumber(today);
  if (daysLeft < 0) return { state: "OVERDUE", daysLeft };
  if (daysLeft <= DEADLINE_SOON_DAYS) return { state: "SOON", daysLeft };
  return { state: "OK", daysLeft };
}

/** Résumé court des travaux d'un passage (3 libellés au plus). */
export function visitSummary(descriptions: readonly string[], max = 3): string {
  const unique = [...new Set(descriptions.map((d) => d.trim()).filter(Boolean))];
  if (unique.length <= max) return unique.join(", ");
  return `${unique.slice(0, max).join(", ")} +${unique.length - max}`;
}

// ───────────── Avis (RG-M14-21, US-M14-11) ─────────────

export const FEEDBACK_COMMENT_MAX = 1000;

export function validateFeedback(input: {
  rating: number;
  comment?: string | null;
}): string | null {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return "Choisissez une note de 1 à 5 étoiles.";
  }
  if (input.comment && input.comment.length > FEEDBACK_COMMENT_MAX) {
    return `Votre commentaire dépasse ${FEEDBACK_COMMENT_MAX} caractères.`;
  }
  return null;
}

/** Note ≤ 3 → notification au gérant ; note ≥ 4 → proposition d'avis Google si configuré. */
export function feedbackFollowUp(
  rating: number,
  googleReviewUrl: string | null | undefined,
): { notifyOwner: boolean; googleReviewUrl: string | null } {
  return {
    notifyOwner: rating <= 3,
    googleReviewUrl: rating >= 4 && googleReviewUrl ? googleReviewUrl : null,
  };
}
