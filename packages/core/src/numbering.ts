import { DomainError } from "./errors";

/** Documents fiscaux (FAC, AV, REC) et opérationnels (OR, DEV, BC, INV, TR, SIN) — A4. */
export type DocumentType = "OR" | "DEV" | "BC" | "FAC" | "AV" | "REC" | "INV" | "TR" | "SIN";

const SITE_SCOPED_DOC_TYPES: ReadonlySet<DocumentType> = new Set([
  "OR",
  "DEV",
  "BC",
  "INV",
  "TR",
  "SIN",
]);

/** A4 — vrai si le document est numéroté par organisation (siteId = null), pas par site. */
export function isFiscalDocumentType(docType: DocumentType): boolean {
  return !SITE_SCOPED_DOC_TYPES.has(docType);
}

export interface DocumentSequenceKey {
  organizationId: string;
  siteId: string | null;
  docType: DocumentType;
  year: number;
}

/** Résout la clé de séquence selon la portée A4 : siteId forcé à null pour un document fiscal. */
export function sequenceKey(
  input: Omit<DocumentSequenceKey, "siteId"> & { siteId?: string | null },
): DocumentSequenceKey {
  return {
    organizationId: input.organizationId,
    docType: input.docType,
    year: input.year,
    siteId: isFiscalDocumentType(input.docType) ? null : (input.siteId ?? null),
  };
}

/** RG-M08-01 — ex. formatDocumentNumber("FAC", 2026, 123) → "FAC-2026-000123". */
export function formatDocumentNumber(docType: DocumentType, year: number, value: number): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      "numbering.invalid_value",
      "Le numéro de séquence doit être un entier positif.",
      { value },
    );
  }
  return `${docType}-${year}-${value.toString().padStart(6, "0")}`;
}

export interface SequenceStore {
  /**
   * Incrémente et renvoie la nouvelle valeur, atomiquement (verrou
   * `SELECT … FOR UPDATE` sur `DocumentSequence` dans l'implémentation réelle
   * de packages/db). Le core ne connaît que ce contrat, pas la base.
   */
  getAndIncrement(key: DocumentSequenceKey): Promise<number>;
}

/** Numéro suivant, sans trou : délègue l'atomicité au SequenceStore injecté. */
export async function nextDocumentNumber(
  store: SequenceStore,
  key: Omit<DocumentSequenceKey, "siteId"> & { siteId?: string | null },
): Promise<string> {
  const resolvedKey = sequenceKey(key);
  const value = await store.getAndIncrement(resolvedKey);
  return formatDocumentNumber(resolvedKey.docType, resolvedKey.year, value);
}

// ───────────── RG-M15-12 — numérotation configurable (settings.numbering[docType]) ─────────────

/** `settings.numbering[docType]` (§14 M15, RG-M15-12). */
export interface NumberingConfig {
  /** Remplace le jeton `{TYPE}` (ex. "F" au lieu de "FAC"). */
  prefix: string;
  /** Jetons : `{TYPE}`, `{SITE}`, `{AAAA}`, `{AA}`, `{MM}`, `{N…}`. */
  pattern: string;
  /** Nombre de chiffres du numéro séquentiel (remplace `{N…}`). */
  padding: number;
  /** Une séquence par site plutôt qu'une séquence unique par organisation. */
  perSite: boolean;
  /** Repart à 1 chaque année (obligatoire et non désactivable pour FAC/AV/REC). */
  resetYearly: boolean;
}

/** Formats par défaut (US-M15-06) : OR/devis par site 5 chiffres, factures par organisation 6 chiffres. */
export const DEFAULT_NUMBERING_CONFIG: Record<DocumentType, NumberingConfig> = {
  OR: {
    prefix: "OR",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  DEV: {
    prefix: "DEV",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  BC: {
    prefix: "BC",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  INV: {
    prefix: "INV",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  TR: {
    prefix: "TR",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  SIN: {
    prefix: "SIN",
    pattern: "{TYPE}-{SITE}-{AAAA}-{N}",
    padding: 5,
    perSite: true,
    resetYearly: true,
  },
  FAC: {
    prefix: "FAC",
    pattern: "{TYPE}-{AAAA}-{N}",
    padding: 6,
    perSite: false,
    resetYearly: true,
  },
  AV: { prefix: "AV", pattern: "{TYPE}-{AAAA}-{N}", padding: 6, perSite: false, resetYearly: true },
  REC: {
    prefix: "REC",
    pattern: "{TYPE}-{AAAA}-{N}",
    padding: 6,
    perSite: false,
    resetYearly: true,
  },
};

const SEQUENCE_TOKEN = /\{N+\}/g;
const YEAR_TOKEN = /\{AAAA\}/g;
// Variantes non globales pour les vérifications ponctuelles (`.test()`) : une regex `g`
// conserve son `lastIndex` entre deux appels et renvoie parfois `false` à tort en réemploi.
const HAS_SEQUENCE_TOKEN = /\{N+\}/;
const HAS_YEAR_TOKEN = /\{AAAA\}/;

export interface NumberingRenderContext {
  /** Code du site (ex. "YOP"), pour le jeton `{SITE}` ; vide pour un document fiscal (A4). */
  siteCode?: string | null;
  year: number;
  /** 1-12, pour le jeton `{MM}` (rarement utilisé). */
  month?: number;
  /** Valeur de la séquence à rendre (généralement `lastValue + 1`). */
  value: number;
}

/** RG-M15-12 — rend un pattern de numérotation, ex. `{TYPE}-{AAAA}-{NNNN}` → "F-2026-0413". */
export function renderNumberingPattern(
  config: NumberingConfig,
  context: NumberingRenderContext,
): string {
  if (!Number.isInteger(context.value) || context.value <= 0) {
    throw new DomainError(
      "numbering.invalid_value",
      "Le numéro de séquence doit être un entier positif.",
      { value: context.value },
    );
  }

  const yyyy = String(context.year).padStart(4, "0");
  const yy = yyyy.slice(-2);
  const mm = context.month ? String(context.month).padStart(2, "0") : "";
  const n = String(context.value).padStart(config.padding, "0");
  const site = context.siteCode ?? "";

  return config.pattern
    .replace(/\{TYPE\}/g, config.prefix)
    .replace(/\{SITE\}/g, site)
    .replace(YEAR_TOKEN, yyyy)
    .replace(/\{AA\}/g, yy)
    .replace(/\{MM\}/g, mm)
    .replace(SEQUENCE_TOKEN, n);
}

/**
 * RG-M15-12 — valide une config de numérotation pour un `docType` donné : présence du jeton
 * `{N…}`, `{AAAA}` requis si `resetYearly`, et pour les documents fiscaux (FAC/AV/REC, A4) :
 * `resetYearly` obligatoirement vrai, `perSite` obligatoirement faux (séquence par organisation).
 */
export function validateNumberingConfig(docType: DocumentType, config: NumberingConfig): void {
  if (config.padding < 1 || config.padding > 10) {
    throw new DomainError(
      "numbering.invalid_padding",
      "Le nombre de chiffres du numéro doit être compris entre 1 et 10.",
      { docType, padding: config.padding },
    );
  }

  if (!HAS_SEQUENCE_TOKEN.test(config.pattern)) {
    throw new DomainError(
      "numbering.pattern_missing_sequence",
      "Le format doit contenir le jeton de numéro séquentiel « {N…} ».",
      { docType, pattern: config.pattern },
    );
  }

  if (config.resetYearly && !HAS_YEAR_TOKEN.test(config.pattern)) {
    throw new DomainError(
      "numbering.pattern_missing_year",
      "Le format doit contenir « {AAAA} » car la numérotation se réinitialise chaque année.",
      { docType, pattern: config.pattern },
    );
  }

  if (isFiscalDocumentType(docType)) {
    if (!config.resetYearly) {
      throw new DomainError(
        "numbering.fiscal_must_reset_yearly",
        `${docType} doit se réinitialiser chaque année (numérotation sans trou, RG-M15-12).`,
        { docType },
      );
    }
    if (config.perSite) {
      throw new DomainError(
        "numbering.fiscal_cannot_be_per_site",
        `${docType} est numéroté par organisation, pas par site (cf. 04-arbitrages-coherence.md) : désactivez « par site ».`,
        { docType },
      );
    }
  }
}

/** RG-M15-06/RG-M15-12 — la valeur de départ ne peut être modifiée qu'à la hausse. */
export function assertStartValueIncrease(currentLastValue: number, newStart: number): void {
  if (!Number.isInteger(newStart) || newStart <= currentLastValue) {
    throw new DomainError(
      "numbering.start_must_increase",
      `La nouvelle valeur de départ (${newStart}) doit être supérieure à la dernière valeur utilisée (${currentLastValue}).`,
      { currentLastValue, newStart },
    );
  }
}
