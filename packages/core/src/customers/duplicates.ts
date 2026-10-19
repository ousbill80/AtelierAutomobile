// RG-M02-07 — détection de doublons clients : score pur à partir de signaux déjà calculés
// (les requêtes trigram/téléphone/NCC sont faites par le routeur, pas ici).

export interface DuplicateSignals {
  samePhone?: boolean;
  sameEmail?: boolean;
  sameNcc?: boolean;
  /** Similarité pg_trgm du displayName, 0 à 1. */
  nameSimilarity?: number | null;
  sameCommune?: boolean;
  sharedVehicle?: boolean;
}

export interface DuplicateScoreResult {
  score: number;
  reasons: string[];
}

const NAME_SIMILARITY_HIGH = 0.85;
const NAME_SIMILARITY_LOW = 0.6;

export const DUPLICATE_BLOCK_THRESHOLD = 80;
export const DUPLICATE_SUGGEST_THRESHOLD = 50;

export function duplicateScore(signals: DuplicateSignals): DuplicateScoreResult {
  let score = 0;
  const reasons: string[] = [];

  if (signals.samePhone) {
    score += 60;
    reasons.push("même téléphone");
  }
  if (signals.sameEmail) {
    score += 50;
    reasons.push("même email");
  }
  if (signals.sameNcc) {
    score += 70;
    reasons.push("même NCC");
  }
  if (signals.nameSimilarity != null) {
    if (signals.nameSimilarity >= NAME_SIMILARITY_HIGH) {
      score += 35;
      reasons.push(`nom similaire à ${Math.round(signals.nameSimilarity * 100)} %`);
    } else if (signals.nameSimilarity >= NAME_SIMILARITY_LOW) {
      score += 20;
      reasons.push(`nom similaire à ${Math.round(signals.nameSimilarity * 100)} %`);
    }
  }
  if (signals.sameCommune) {
    score += 5;
    reasons.push("même commune");
  }
  if (signals.sharedVehicle) {
    score += 40;
    reasons.push("même véhicule");
  }

  return { score: Math.min(score, 100), reasons };
}

export type DuplicateSeverity = "BLOCK" | "SUGGEST" | "NONE";

/** Score ≥ 80 bloque la création (motif requis) ; 50-79 n'est que suggéré dans /clients/doublons. */
export function duplicateSeverity(score: number): DuplicateSeverity {
  if (score >= DUPLICATE_BLOCK_THRESHOLD) return "BLOCK";
  if (score >= DUPLICATE_SUGGEST_THRESHOLD) return "SUGGEST";
  return "NONE";
}
