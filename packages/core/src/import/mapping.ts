import { SYNONYMS, type TargetField } from "./synonyms";

/**
 * RG-M13-05 — Normalisation des en-têtes : minuscules, sans accents,
 * ponctuation → espace, espaces multiples réduits.
 * Ex. « Tél. Portable » → `tel portable`.
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Distance de Levenshtein (nombre minimal d'opérations d'édition). */
export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0]![j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // suppression
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return matrix[rows - 1]![cols - 1]!;
}

export type MappingSource = "synonym" | "ai" | "memory";

export interface ColumnMatch {
  field: TargetField;
  confidence: number;
  source: MappingSource;
}

const EXACT_MATCH_CONFIDENCE = 1.0;
const INCLUSION_MATCH_CONFIDENCE = 0.8;
const LEVENSHTEIN_MATCH_CONFIDENCE = 0.7;
const LEVENSHTEIN_MAX_DISTANCE = 2;

/**
 * RG-M13-06 — associe un en-tête déjà normalisé au champ cible le plus
 * probable parmi la table de synonymes. `undefined` si aucune correspondance
 * (la colonne reste « à associer », éventuellement envoyée à l'IA en
 * RG-M13-07).
 */
export function matchColumn(normalizedHeader: string): ColumnMatch | undefined {
  let best: ColumnMatch | undefined;

  for (const [field, synonyms] of Object.entries(SYNONYMS) as [TargetField, readonly string[]][]) {
    for (const synonym of synonyms) {
      let confidence: number | undefined;

      if (normalizedHeader === synonym) {
        confidence = EXACT_MATCH_CONFIDENCE;
      } else if (normalizedHeader.includes(synonym) || synonym.includes(normalizedHeader)) {
        confidence = INCLUSION_MATCH_CONFIDENCE;
      } else if (levenshteinDistance(normalizedHeader, synonym) <= LEVENSHTEIN_MAX_DISTANCE) {
        confidence = LEVENSHTEIN_MATCH_CONFIDENCE;
      }

      if (confidence !== undefined && (!best || confidence > best.confidence)) {
        best = { field, confidence, source: "synonym" };
      }
    }
  }

  return best;
}

export interface SuggestedMapping {
  column: string;
  field: TargetField | null;
  confidence: number;
  source: MappingSource | null;
}

/**
 * RG-M13-06/08 — propose une correspondance pour chaque en-tête du fichier.
 * `memorizedMapping` (signature d'en-tête → colonnes) pré-associe à 100 % un
 * fichier déjà vu (RG-M13-08).
 */
export function suggestColumnMapping(
  headers: readonly string[],
  memorizedMapping?: Record<string, TargetField>,
): SuggestedMapping[] {
  return headers.map((column) => {
    if (memorizedMapping && memorizedMapping[column]) {
      return { column, field: memorizedMapping[column], confidence: 1.0, source: "memory" };
    }

    const normalized = normalizeHeader(column);
    const match = matchColumn(normalized);

    if (!match) {
      return { column, field: null, confidence: 0, source: null };
    }

    return { column, field: match.field, confidence: match.confidence, source: match.source };
  });
}

/** RG-M13-08 — signature sha256 des en-têtes normalisés triés. */
export async function headerSignature(headers: readonly string[]): Promise<string> {
  const normalizedSorted = headers.map(normalizeHeader).sort().join("|");
  const data = new TextEncoder().encode(normalizedSorted);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const COMPANY_PATTERN = /\b(SARL|SA|SAS|SASU|GIE|ETS|STE|SOCIETE|GROUPE|TRANSPORT|CI)\b/i;

/** RG-M13-09 — détecte si un nom désigne une entreprise plutôt qu'un particulier. */
export function detectCompanyFromName(name: string): boolean {
  return COMPANY_PATTERN.test(name);
}

/** Marques reconnues pour découper une colonne "Véhicule" combinée (RG-M13-09). */
export const KNOWN_VEHICLE_MAKES: readonly string[] = [
  "Toyota",
  "Peugeot",
  "Renault",
  "Nissan",
  "Hyundai",
  "Kia",
  "Honda",
  "Mercedes",
  "Volkswagen",
  "Ford",
  "Mitsubishi",
  "Suzuki",
  "Mazda",
  "Opel",
  "Citroen",
  "Isuzu",
  "Land Rover",
  "Chevrolet",
];

export interface SplitVehicleName {
  make: string | null;
  model: string | null;
}

/**
 * RG-M13-09 — découpe une colonne "Véhicule" (ex. « Toyota Corolla ») en
 * marque (premier mot reconnu dans la liste des marques) et modèle (reste).
 */
export function splitVehicleName(value: string): SplitVehicleName {
  const trimmed = value.trim();
  if (trimmed === "") return { make: null, model: null };

  const lower = trimmed.toLowerCase();
  // Préfère la marque reconnue la plus longue (ex. "Land Rover" avant "Land").
  const known = [...KNOWN_VEHICLE_MAKES]
    .sort((a, b) => b.length - a.length)
    .find((make) => lower === make.toLowerCase() || lower.startsWith(`${make.toLowerCase()} `));

  if (!known) {
    return { make: null, model: trimmed };
  }

  const model = trimmed.slice(known.length).trim();
  return { make: known, model: model === "" ? null : model };
}
