// M17 RG-M17-17 / M13 RG-M13-07 — correspondance de colonnes assistée par IA : seules les
// colonnes à confiance < 0,7 lui sont envoyées, avec 5 exemples masqués ; la sortie est
// filtrée aux champs cibles fournis ; la proposition n'est retenue par défaut qu'à ≥ 0,8 et
// reste toujours marquée « Proposé par l'assistant » à confirmer.

/** Colonnes envoyées à l'IA : celles que les synonymes associent à moins de 0,7. */
export const AI_MAPPING_THRESHOLD = 0.7;
/** Proposition IA pré-sélectionnée seulement à partir de 0,8. */
export const AI_MAPPING_AUTO_ACCEPT = 0.8;
export const AI_MAPPING_MAX_SAMPLES = 5;

const PHONE_LIKE = /^[+\d][\d\s.\-()]{6,}$/;
const EMAIL_LIKE = /^([^@\s])[^@\s]*@([^@\s]+)$/;
const WORDS_ONLY = /^[\p{L}][\p{L}\s'’.-]*$/u;

/**
 * RG-M13-07 — masque une valeur d'exemple : téléphone → 2 premiers chiffres puis `X`,
 * email → initiale + domaine, nom → initiales. Montants, dates, plaques restent lisibles.
 */
export function maskSampleValue(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const email = EMAIL_LIKE.exec(v);
  if (email) return `${email[1]}…@${email[2]}`;
  const digits = v.replace(/\D/g, "");
  if (PHONE_LIKE.test(v) && digits.length >= 8) {
    let kept = 0;
    return v.replace(/\d/g, (d) => (kept++ < 2 ? d : "X"));
  }
  if (WORDS_ONLY.test(v)) {
    return v
      .split(/\s+/)
      .map((w) => `${w.charAt(0).toUpperCase()}.`)
      .join(" ");
  }
  return v;
}

export function maskSamples(samples: readonly string[]): string[] {
  return samples
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, AI_MAPPING_MAX_SAMPLES)
    .map(maskSampleValue);
}

export interface AiColumnMapping {
  column: string;
  field: string | null;
  confidence: number;
}

/** Ne garde que les colonnes demandées et les champs cibles autorisés (RG-M17-17). */
export function filterAiMappings(
  mappings: readonly AiColumnMapping[],
  columns: readonly string[],
  targetFields: readonly string[],
): AiColumnMapping[] {
  const allowed = new Set(targetFields);
  const wanted = new Set(columns);
  const seen = new Set<string>();
  const out: AiColumnMapping[] = [];
  for (const m of mappings) {
    if (!wanted.has(m.column) || seen.has(m.column)) continue;
    seen.add(m.column);
    const field = m.field && allowed.has(m.field) ? m.field : null;
    out.push({
      column: m.column,
      field,
      confidence: field ? Math.max(0, Math.min(1, m.confidence)) : 0,
    });
  }
  for (const column of columns) {
    if (!seen.has(column)) out.push({ column, field: null, confidence: 0 });
  }
  return out;
}

export interface MappingEntryLike {
  column: string;
  field: string | null;
  confidence: number;
  source: "synonym" | "ai" | "memory" | null;
}

export type MergedMappingEntry<T extends MappingEntryLike> = T & {
  /** Proposition IA (affichée en orange), même quand elle n'est pas pré-sélectionnée. */
  aiProposal?: { field: string; confidence: number };
};

/**
 * Fusionne les propositions IA dans la correspondance par synonymes : une colonne < 0,7 reçoit
 * le champ IA s'il est ≥ 0,8 (source `ai`) ; sinon la proposition est seulement jointe.
 */
export function mergeAiMappings<T extends MappingEntryLike>(
  mapping: readonly T[],
  ai: readonly AiColumnMapping[],
): MergedMappingEntry<T>[] {
  const byColumn = new Map(ai.map((m) => [m.column, m]));
  return mapping.map((entry) => {
    const proposal = byColumn.get(entry.column);
    if (entry.confidence >= AI_MAPPING_THRESHOLD || !proposal?.field) return entry;
    const aiProposal = { field: proposal.field, confidence: proposal.confidence };
    if (proposal.confidence >= AI_MAPPING_AUTO_ACCEPT) {
      return {
        ...entry,
        field: proposal.field,
        confidence: proposal.confidence,
        source: "ai",
        aiProposal,
      } as MergedMappingEntry<T>;
    }
    return { ...entry, aiProposal } as MergedMappingEntry<T>;
  });
}
