// M17 RG-M17-18 — extraction de documents (vision) : normalisation par le code des champs
// proposés par le modèle (plaque RG-M13-13 via `normalizePlate`, dates RG-M13-11, montants
// RG-M13-12), seuils de confiance (< 0,4 : jamais pré-rempli ; < 0,7 : « À vérifier ») et
// rapprochement des lignes de facture fournisseur avec le catalogue.
import { normalizeImportAmount, normalizeImportDate } from "../import/normalize";
import { normalizePlate } from "../plate";

export const DOCUMENT_KINDS = [
  "VEHICLE_REGISTRATION",
  "INSPECTION_STICKER",
  "ODOMETER",
  "SUPPLIER_INVOICE",
  "CLAIM_REPORT",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type ExtractedFieldType = "plate" | "date" | "text" | "int" | "amount" | "fuel";

/** Champs attendus par type de document (clé → type de normalisation). */
export const DOCUMENT_FIELDS: Record<DocumentKind, Record<string, ExtractedFieldType>> = {
  VEHICLE_REGISTRATION: {
    plate: "plate",
    make: "text",
    model: "text",
    vin: "text",
    firstRegistrationDate: "date",
    fuel: "fuel",
    ownerName: "text",
  },
  INSPECTION_STICKER: { plate: "plate", inspectionExpiryDate: "date" },
  ODOMETER: { mileage: "int" },
  SUPPLIER_INVOICE: {
    supplierName: "text",
    invoiceNumber: "text",
    invoiceDate: "date",
    total: "amount",
  },
  CLAIM_REPORT: {
    accidentDate: "date",
    accidentPlace: "text",
    policyNumber: "text",
    insurerName: "text",
    driverName: "text",
    otherPartyName: "text",
    plate: "plate",
    circumstances: "text",
  },
};

/** Sous ce seuil un champ n'est jamais pré-rempli (§11). */
export const EXTRACTION_MIN_CONFIDENCE = 0.4;
/** Sous ce seuil un champ pré-rempli est surligné « À vérifier » (US-M17-06). */
export const EXTRACTION_REVIEW_CONFIDENCE = 0.7;
export const UNREADABLE_DOCUMENT_MESSAGE =
  "Document illisible, reprenez la photo en pleine lumière.";

export interface RawExtractedField {
  value: string | number | null;
  confidence: number;
}

export interface ExtractedField {
  value: string | number;
  confidence: number;
  needsReview: boolean;
}

export interface RawInvoiceLine {
  reference?: string | null;
  description: string;
  quantity: number;
  unitPrice?: number | string | null;
  total?: number | string | null;
}

export interface NormalizedExtraction {
  fields: Record<string, ExtractedField>;
  warnings: string[];
  unreadable: boolean;
}

const FUELS: Record<string, string> = {
  essence: "PETROL",
  ess: "PETROL",
  petrol: "PETROL",
  gasoil: "DIESEL",
  gazole: "DIESEL",
  diesel: "DIESEL",
  go: "DIESEL",
  hybride: "HYBRID",
  hybrid: "HYBRID",
  electrique: "ELECTRIC",
  electric: "ELECTRIC",
  gpl: "LPG",
};

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Normalise une valeur selon son type ; `null` si inexploitable. */
export function normalizeExtractedValue(
  type: ExtractedFieldType,
  raw: string | number,
  now: Date,
): string | number | null {
  const text = String(raw).trim();
  if (!text) return null;
  switch (type) {
    case "plate": {
      const plate = normalizePlate(text);
      return plate.plateType === "NONE" ? null : plate.plate;
    }
    case "date": {
      // Le modèle renvoie souvent l'ISO ; sinon formats ivoiriens (jj/mm/aaaa…).
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
      if (iso) return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
      const result = normalizeImportDate(text, now);
      return result.date ? toIsoDate(result.date) : null;
    }
    case "amount": {
      try {
        return normalizeImportAmount(text).amount;
      } catch {
        return null;
      }
    }
    case "int": {
      const digits = text.replace(/[\s  .,]/g, "").replace(/km$/i, "");
      return /^\d+$/.test(digits) ? Number(digits) : null;
    }
    case "fuel":
      return FUELS[fold(text)] ?? null;
    case "text":
      return text.replace(/\s+/g, " ");
  }
}

/**
 * RG-M17-18 / §11 — ne garde que les champs attendus pour ce type, normalisés par le code,
 * à confiance ≥ 0,4 ; marque « À vérifier » sous 0,7. Aucun champ exploitable → illisible.
 */
export function normalizeExtraction(
  kind: DocumentKind,
  raw: Record<string, RawExtractedField | undefined>,
  now: Date,
): NormalizedExtraction {
  const fields: Record<string, ExtractedField> = {};
  const warnings: string[] = [];
  for (const [name, type] of Object.entries(DOCUMENT_FIELDS[kind])) {
    const entry = raw[name];
    if (!entry || entry.value === null || entry.value === undefined) continue;
    const confidence = Math.max(0, Math.min(1, entry.confidence));
    if (confidence < EXTRACTION_MIN_CONFIDENCE) continue;
    const value = normalizeExtractedValue(type, entry.value, now);
    if (value === null) {
      warnings.push(`Champ « ${name} » illisible.`);
      continue;
    }
    fields[name] = { value, confidence, needsReview: confidence < EXTRACTION_REVIEW_CONFIDENCE };
  }
  const unreadable = Object.keys(fields).length === 0;
  if (unreadable) warnings.unshift(UNREADABLE_DOCUMENT_MESSAGE);
  return { fields, warnings, unreadable };
}

// ── Facture fournisseur : rapprochement des lignes (RG-M17-18) ──

export interface CatalogProductLike {
  id: string;
  sku: string;
  name: string;
  oemReference?: string | null;
}

export interface MatchedInvoiceLine {
  description: string;
  reference: string | null;
  quantity: number;
  unitPrice: number | null;
  total: number | null;
  productId: string | null;
  matchedBy: "oem" | "sku" | "name" | null;
  similarity: number;
}

function compact(value: string): string {
  return fold(value).replace(/[^a-z0-9]/g, "");
}

function bigrams(value: string): string[] {
  const s = ` ${fold(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Similarité de Dice sur les bigrammes de caractères (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const counts = new Map<string, number>();
  for (const g of x) counts.set(g, (counts.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of y) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      common++;
      counts.set(g, n - 1);
    }
  }
  return (2 * common) / (x.length + y.length);
}

export const SUPPLIER_LINE_MIN_SIMILARITY = 0.6;

function amountOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  try {
    return normalizeImportAmount(value).amount;
  } catch {
    return null;
  }
}

/** Rapprochement par `oemReference` → `sku` → similarité de nom ≥ 0,6. */
export function matchSupplierInvoiceLines(
  lines: readonly RawInvoiceLine[],
  products: readonly CatalogProductLike[],
): MatchedInvoiceLine[] {
  return lines.map((line) => {
    const reference = line.reference?.trim() || null;
    const base = {
      description: line.description.trim(),
      reference,
      quantity: line.quantity,
      unitPrice: amountOrNull(line.unitPrice),
      total: amountOrNull(line.total),
    };
    if (reference) {
      const ref = compact(reference);
      const byOem = products.find((p) => p.oemReference && compact(p.oemReference) === ref);
      if (byOem) return { ...base, productId: byOem.id, matchedBy: "oem" as const, similarity: 1 };
      const bySku = products.find((p) => compact(p.sku) === ref);
      if (bySku) return { ...base, productId: bySku.id, matchedBy: "sku" as const, similarity: 1 };
    }
    let best: { id: string; score: number } | null = null;
    for (const product of products) {
      const score = nameSimilarity(line.description, product.name);
      if (!best || score > best.score) best = { id: product.id, score };
    }
    if (best && best.score >= SUPPLIER_LINE_MIN_SIMILARITY) {
      return { ...base, productId: best.id, matchedBy: "name" as const, similarity: best.score };
    }
    return { ...base, productId: null, matchedBy: null, similarity: best?.score ?? 0 };
  });
}

/** Contrôle Σ lignes = total : écart en FCFA (0 si cohérent, `null` si non calculable). */
export function invoiceTotalGap(
  lines: readonly MatchedInvoiceLine[],
  total: number | null,
): number | null {
  if (total === null) return null;
  let sum = 0;
  for (const line of lines) {
    const lineTotal =
      line.total ?? (line.unitPrice !== null ? Math.round(line.unitPrice * line.quantity) : null);
    if (lineTotal === null) return null;
    sum += lineTotal;
  }
  return total - sum;
}
