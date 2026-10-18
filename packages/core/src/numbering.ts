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
