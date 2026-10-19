// RG-M02-19 — analyse de la requête de recherche globale : décide quelles sources interroger
// (téléphone, plaque, numéro de document, nom/VIN) et prépare les formes normalisées.

/** Préfixes de numéro de document reconnus par RG-M02-19. */
export const SEARCH_DOCUMENT_PREFIXES = ["OR-", "DEV-", "FAC-", "AV-", "REC-", "BC-"] as const;
export type SearchDocumentPrefix = (typeof SEARCH_DOCUMENT_PREFIXES)[number];

export type SearchQueryKind = "PHONE" | "DOCUMENT" | "PLATE" | "NAME";

export interface SearchQueryAnalysis {
  /** Sources à interroger, par ordre de priorité. Toujours au moins une. */
  kinds: SearchQueryKind[];
  /** Requête nettoyée (espaces multiples réduits). */
  text: string;
  /** Chiffres seuls (recherche par suffixe de téléphone). */
  digits: string;
  /** Forme compacte majuscule `[A-Z0-9]` (comparaison avec `Vehicle.plateCompact`). */
  plateCompact: string;
  /** `plateCompact` avec les confusions O→0 et I→1 neutralisées (RG-M02-05 §1). */
  plateLoose: string;
  /** Requête en majuscules pour comparer aux numéros de document. */
  documentNumber: string;
  /** Préfixe de document détecté, s'il y en a un. */
  documentPrefix: SearchDocumentPrefix | null;
}

/** Neutralise les confusions de saisie tolérées par la recherche de plaque (0/O, 1/I). */
export function loosenPlate(compact: string): string {
  return compact.replace(/O/g, "0").replace(/I/g, "1");
}

/**
 * RG-M02-19 — classe la requête :
 * - préfixe de document (`OR-`, `DEV-`, `FAC-`, `AV-`, `REC-`, `BC-`) → numéro de document ;
 * - aucun caractère alphabétique et ≥ 4 chiffres → téléphone (et numéro de document, un numéro
 *   d'OR pouvant être tapé sans son préfixe) ;
 * - nombre court (< 4 chiffres) → numéro de document ;
 * - lettres et chiffres mêlés, ≥ 4 caractères utiles → plaque (VIN/n° de flotte aussi testés
 *   via la recherche par nom) ;
 * - sinon → nom (similarité trigramme).
 */
export function analyzeSearchQuery(raw: string): SearchQueryAnalysis {
  const text = raw.trim().replace(/\s+/g, " ");
  const upper = text.toUpperCase();
  const digits = text.replace(/\D/g, "");
  const plateCompact = upper.replace(/[^A-Z0-9]/g, "");
  const hasLetters = /\p{L}/u.test(text);
  const documentPrefix = SEARCH_DOCUMENT_PREFIXES.find((p) => upper.startsWith(p)) ?? null;

  const kinds: SearchQueryKind[] = [];
  if (documentPrefix) {
    kinds.push("DOCUMENT");
  } else if (!hasLetters && digits.length >= 4) {
    kinds.push("PHONE", "DOCUMENT");
  } else if (!hasLetters && digits.length > 0) {
    kinds.push("DOCUMENT");
  } else if (plateCompact.length >= 4 && /\d/.test(plateCompact) && /[A-Z]/.test(plateCompact)) {
    kinds.push("PLATE", "NAME");
  } else {
    kinds.push("NAME");
  }

  return {
    kinds,
    text,
    digits,
    plateCompact,
    plateLoose: loosenPlate(plateCompact),
    documentNumber: upper.replace(/\s+/g, ""),
    documentPrefix,
  };
}

/** Rang de pertinence RG-M02-19 : correspondance exacte (3) > préfixe (2) > le reste (1). */
export function matchRank(value: string, query: string): 1 | 2 | 3 {
  const v = value.toLowerCase();
  const q = query.toLowerCase();
  if (v === q) return 3;
  if (v.startsWith(q)) return 2;
  return 1;
}
