export type ReachabilityStatus = "REACHABLE" | "OPTED_OUT" | "DO_NOT_REMIND" | "UNREACHABLE";

export interface ComputeReachabilityInput {
  /** Téléphone mobile valide (type MOBILE), condition suffisante indépendamment de l'email. */
  hasMobilePhone: boolean;
  hasEmail: boolean;
  doNotRemind: boolean;
  optedOutAt: Date | null | undefined;
}

/**
 * Section 5 du PRD M02 — joignabilité client :
 * `REACHABLE` (mobile ou email, pas de désinscription) · `OPTED_OUT` · `DO_NOT_REMIND` ·
 * `UNREACHABLE` (aucun moyen de contact). `doNotRemind` (décision interne) est prioritaire
 * sur `optedOutAt` (réponse STOP du client) dans l'affichage, les deux bloquant les relances.
 */
export function computeReachability(input: ComputeReachabilityInput): ReachabilityStatus {
  if (input.doNotRemind) {
    return "DO_NOT_REMIND";
  }
  if (input.optedOutAt) {
    return "OPTED_OUT";
  }
  if (input.hasMobilePhone || input.hasEmail) {
    return "REACHABLE";
  }
  return "UNREACHABLE";
}
