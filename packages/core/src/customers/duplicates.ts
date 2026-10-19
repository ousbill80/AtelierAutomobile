export interface DuplicateSignals {
  /** Même téléphone/phone2/whatsappPhone (comparaison E.164 déjà faite par l'appelant). */
  samePhone: boolean;
  sameEmail: boolean;
  /** Même NCC (numéro de compte contribuable), pour les entreprises. */
  sameNcc: boolean;
  /** Similarité trigram (pg_trgm `similarity()`) entre les `displayName`, 0 à 1. */
  displayNameSimilarity: number;
  sameCommune: boolean;
  /** Partagent un véhicule (même `plateCompact` ou VIN). */
  sharedVehicle: boolean;
}

export type DuplicateLevel = "NONE" | "SUGGESTION" | "BLOCKING";

export interface DuplicateScoreResult {
  /** 0 à 100. */
  score: number;
  /** Raisons en français, dans l'ordre des signaux détectés (ex. « même téléphone »). */
  reasons: string[];
  /** BLOCKING ≥ 80 (alerte bloquante à la création), SUGGESTION 50-79 (`/clients/doublons`), NONE < 50. */
  level: DuplicateLevel;
}

const BLOCKING_THRESHOLD = 80;
const SUGGESTION_THRESHOLD = 50;
const NAME_SIMILARITY_HIGH = 0.85;
const NAME_SIMILARITY_LOW = 0.6;

/** RG-M02-07 — score de doublon client (0-100), signal par signal. */
export function computeDuplicateScore(signals: DuplicateSignals): DuplicateScoreResult {
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
  if (signals.displayNameSimilarity >= NAME_SIMILARITY_HIGH) {
    score += 35;
    reasons.push(`nom similaire à ${Math.round(signals.displayNameSimilarity * 100)} %`);
  } else if (signals.displayNameSimilarity >= NAME_SIMILARITY_LOW) {
    score += 20;
    reasons.push(`nom similaire à ${Math.round(signals.displayNameSimilarity * 100)} %`);
  }
  if (signals.sameCommune) {
    score += 5;
    reasons.push("même commune");
  }
  if (signals.sharedVehicle) {
    score += 40;
    reasons.push("même véhicule");
  }

  const cappedScore = Math.min(100, score);
  const level: DuplicateLevel =
    cappedScore >= BLOCKING_THRESHOLD
      ? "BLOCKING"
      : cappedScore >= SUGGESTION_THRESHOLD
        ? "SUGGESTION"
        : "NONE";

  return { score: cappedScore, reasons, level };
}
