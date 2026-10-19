// RG-M04-08 / US-M04-05 — approbation des lignes et plafond d'autorisation.
import type { ApprovalSource, ApprovalState, Payer } from "./types";

export interface ApprovalDecisionInput {
  payer: Payer;
  /** "CHECK_IN" : ligne saisie à la réception avec l'accord signé du client. */
  phase: "CHECK_IN" | "AFTER_CHECK_IN";
  /** Plafond d'autorisation TTC (`checkIn.authorizationCeiling`), 0 = aucun. */
  authorizationCeiling: number;
  /** Cumul TTC des lignes déjà pré-autorisées après la réception (non annulées). */
  preAuthorizedTotal: number;
  /** TTC de la nouvelle ligne. */
  lineTotal: number;
}

export interface ApprovalDecision {
  approval: ApprovalState;
  approvalSource: ApprovalSource | null;
}

export function decideLineApproval(input: ApprovalDecisionInput): ApprovalDecision {
  if (input.payer === "WARRANTY" || input.payer === "INTERNAL") {
    return { approval: "NOT_REQUIRED", approvalSource: null };
  }
  if (input.phase === "CHECK_IN") {
    return { approval: "APPROVED", approvalSource: "CHECK_IN" };
  }
  const ceiling = Math.max(0, input.authorizationCeiling);
  if (ceiling > 0 && input.preAuthorizedTotal + input.lineTotal <= ceiling) {
    return { approval: "APPROVED", approvalSource: "PRE_AUTHORIZED" };
  }
  return { approval: "PENDING", approvalSource: null };
}
