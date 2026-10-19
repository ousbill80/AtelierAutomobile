// RG-M09-03 — ouverture, rattachement, fermeture et réouverture du dossier de recouvrement.
import { diffDays } from "../reminders/dates";

export type CollectionStatusLike =
  "OPEN" | "PROMISED" | "PAUSED" | "DISPUTED" | "ESCALATED" | "CLOSED_PAID" | "CLOSED_WRITTEN_OFF";

export const ACTIVE_CASE_STATUSES: readonly CollectionStatusLike[] = [
  "OPEN",
  "PROMISED",
  "PAUSED",
  "DISPUTED",
  "ESCALATED",
];

export function isActiveCase(status: CollectionStatusLike): boolean {
  return ACTIVE_CASE_STATUSES.includes(status);
}

export interface ExistingCase {
  id: string;
  status: CollectionStatusLike;
  closedAt: Date | null;
}

export type CaseDecision =
  | { action: "none" }
  | { action: "open" }
  | { action: "update"; caseId: string }
  | { action: "reopen"; caseId: string }
  | { action: "close"; caseId: string; status: "CLOSED_PAID" | "CLOSED_WRITTEN_OFF" };

export interface DecideCaseInput {
  /** Dossier actif du client s'il existe, sinon le dernier dossier fermé. */
  activeCase: ExistingCase | null;
  lastClosedCase: ExistingCase | null;
  overdueDue: number;
  /** Solde ouvert passé en perte uniquement (rien d'autre dû). */
  onlyWrittenOffLeft?: boolean;
  minAmount: number;
  reopenWithinDays: number;
  today: Date;
}

/**
 * - dossier actif + `overdueDue = 0` → fermeture `CLOSED_PAID` (ou `CLOSED_WRITTEN_OFF`) ;
 * - dossier actif + retard → mise à jour (une nouvelle facture rejoint le dossier) ;
 * - pas de dossier actif + retard ≥ minAmount → réouverture si fermé depuis < 30 j, sinon nouveau.
 */
export function decideCaseAction(input: DecideCaseInput): CaseDecision {
  const { activeCase, lastClosedCase, overdueDue, minAmount, reopenWithinDays, today } = input;
  if (activeCase) {
    if (overdueDue <= 0) {
      return {
        action: "close",
        caseId: activeCase.id,
        status: input.onlyWrittenOffLeft ? "CLOSED_WRITTEN_OFF" : "CLOSED_PAID",
      };
    }
    return { action: "update", caseId: activeCase.id };
  }
  if (overdueDue < minAmount) return { action: "none" };
  if (
    lastClosedCase?.closedAt &&
    lastClosedCase.status === "CLOSED_PAID" &&
    diffDays(today, lastClosedCase.closedAt) < reopenWithinDays
  ) {
    return { action: "reopen", caseId: lastClosedCase.id };
  }
  return { action: "open" };
}

/**
 * Fin de pause ou de promesse : retour au statut précédent ; `ESCALATED` est restitué si le
 * dossier a été escaladé (§5.1, `escalatedAt`).
 */
export function statusAfterResume(input: {
  previousStatus: CollectionStatusLike | null;
  escalatedAt: Date | null;
}): CollectionStatusLike {
  if (input.escalatedAt) return "ESCALATED";
  const prev = input.previousStatus;
  if (!prev || prev === "PAUSED" || prev === "PROMISED" || !isActiveCase(prev)) return "OPEN";
  return prev;
}

/** Une pause manuelle dure au plus 30 jours (RG-M09-07). */
export const MAX_PAUSE_DAYS = 30;

/** 3 appels « pas de réponse » consécutifs → « Injoignable » (US-M09-08). */
export const UNREACHABLE_THRESHOLD = 3;

export function isUnreachable(unreachableCount: number): boolean {
  return unreachableCount >= UNREACHABLE_THRESHOLD;
}
