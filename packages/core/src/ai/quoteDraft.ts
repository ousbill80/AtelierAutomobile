// M17 RG-M17-13 — pré-devis : présélection des candidats du catalogue par le code, puis
// construction des lignes à partir de la proposition de l'IA. L'IA ne choisit que parmi la
// liste candidate (tout autre `catalogId` est rejeté), jamais les temps de main-d'œuvre
// (`LaborOperation.standardHours`) ni les prix (calculés ensuite par M05 / core/money).
import { matchCompatibility } from "../inventory/compatibility";

export type DraftPriority = "URGENT" | "WATCH";
export type DraftKind = "LABOR" | "PART";

export interface DraftNeed {
  /** Clé de regroupement (`insp:<itemId>` pour un point d'inspection, `complaint` sinon). */
  key: string;
  label: string;
  priority: DraftPriority | null;
  measurement?: string | null;
  comment?: string | null;
  category?: string | null;
  inspectionItemId?: string | null;
  recommendedProductIds?: string[];
  recommendedLaborIds?: string[];
}

export interface DraftCatalogProduct {
  id: string;
  name: string;
  category?: string | null;
  sku?: string | null;
  oemReference?: string | null;
  compatibleWith: string[];
}

export interface DraftCatalogLabor {
  id: string;
  name: string;
  category?: string | null;
  standardHours: number;
}

export interface DraftVehicle {
  make?: string | null;
  model?: string | null;
  year?: number | null;
}

export interface DraftCandidate {
  catalogId: string;
  kind: DraftKind;
  name: string;
  category: string | null;
  /** MO uniquement : temps barème (seule source de la quantité). */
  standardHours?: number;
}

export const MAX_DRAFT_CANDIDATES = 80;
export const UNPRICED_PREFIX = "À chiffrer";

const STOP_WORDS = new Set([
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "et",
  "a",
  "au",
  "aux",
  "en",
  "un",
  "une",
  "pour",
  "sur",
  "avec",
  "avant",
  "arriere",
  "av",
  "ar",
  "ou",
  "est",
  "il",
  "y",
  "quand",
  "je",
]);

/** Mots significatifs, sans accents, pluriels simples ramenés au singulier. */
export function draftTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));
}

// Vocabulaire atelier : un besoin évoque aussi les pièces/opérations associées.
const RELATED: Record<string, string[]> = {
  vidange: ["huile", "filtre", "lubrifiant", "entretien"],
  freinage: ["frein", "plaquette", "disque"],
  frein: ["freinage", "plaquette", "disque"],
  revision: ["vidange", "huile", "filtre", "entretien"],
  batterie: ["electrique", "demarrage"],
  pneu: ["pneumatique", "equilibrage", "parallelisme"],
  pneumatique: ["pneu", "equilibrage"],
  climatisation: ["clim", "recharge", "gaz"],
  amortisseur: ["suspension"],
  courroie: ["distribution", "galet"],
};

function expand(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) {
    out.add(w);
    for (const r of RELATED[w] ?? []) out.add(r);
  }
  return out;
}

function overlap(a: readonly string[], b: ReadonlySet<string>): number {
  let score = 0;
  for (const w of a) {
    if (b.has(w)) score += 1;
    else if (
      w.length >= 5 &&
      [...b].some((x) => x.length >= 5 && x.slice(0, 5) === w.slice(0, 5))
    ) {
      score += 0.5;
    }
  }
  return score;
}

export interface SelectCandidatesInput {
  needs: DraftNeed[];
  complaint?: string | null;
  diagnosis?: string | null;
  vehicle: DraftVehicle;
  products: DraftCatalogProduct[];
  labor: DraftCatalogLabor[];
  limit?: number;
}

export interface SelectCandidatesResult {
  candidates: DraftCandidate[];
  /** Faux si le véhicule n'a pas de marque/modèle : « Compatibilité non vérifiée ». */
  compatibilityChecked: boolean;
}

/**
 * RG-M17-13 — liste candidate (≤ 80) : recommandations de l'inspection d'abord, puis
 * articles dont le nom/catégorie recoupe les besoins. Les pièces liées à un autre véhicule
 * sont exclues ; une pièce sans compatibilité renseignée est universelle.
 */
export function selectQuoteCandidates(input: SelectCandidatesInput): SelectCandidatesResult {
  const limit = input.limit ?? MAX_DRAFT_CANDIDATES;
  const compatibilityChecked = Boolean(input.vehicle.make && input.vehicle.model);
  const words = expand([
    ...input.needs.flatMap((n) => [
      ...draftTokens(n.label),
      ...draftTokens(n.category),
      ...draftTokens(n.comment),
    ]),
    ...draftTokens(input.complaint),
    ...draftTokens(input.diagnosis),
  ]);
  const recommended = new Set(
    input.needs.flatMap((n) => [
      ...(n.recommendedProductIds ?? []),
      ...(n.recommendedLaborIds ?? []),
    ]),
  );
  const compatible = (p: DraftCatalogProduct) =>
    !compatibilityChecked ||
    p.compatibleWith.length === 0 ||
    matchCompatibility(p.compatibleWith, {
      make: input.vehicle.make ?? null,
      model: input.vehicle.model ?? null,
      year: input.vehicle.year ?? null,
    });
  const scored: { candidate: DraftCandidate; score: number }[] = [];
  for (const p of input.products) {
    if (!compatible(p)) continue;
    const score =
      (recommended.has(p.id) ? 100 : 0) +
      overlap([...draftTokens(p.name), ...draftTokens(p.category)], words);
    if (score > 0) {
      scored.push({
        candidate: { catalogId: p.id, kind: "PART", name: p.name, category: p.category ?? null },
        score,
      });
    }
  }
  for (const op of input.labor) {
    const score =
      (recommended.has(op.id) ? 100 : 0) +
      overlap([...draftTokens(op.name), ...draftTokens(op.category)], words);
    if (score > 0) {
      scored.push({
        candidate: {
          catalogId: op.id,
          kind: "LABOR",
          name: op.name,
          category: op.category ?? null,
          standardHours: op.standardHours,
        },
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.candidate.name.localeCompare(b.candidate.name));
  return { candidates: scored.slice(0, limit).map((s) => s.candidate), compatibilityChecked };
}

/** Ligne proposée par le modèle (sortie validée par Zod, `prompts/quote_draft`). */
export interface AiDraftLine {
  kind: DraftKind;
  catalogId: string | null;
  quantity: number;
  reason: string;
  priority: DraftPriority | null;
  optional: boolean;
  /** Libellé du besoin couvert (point d'inspection ou doléance). */
  need?: string | null;
}

export interface QuoteDraftLine {
  key: string;
  kind: DraftKind;
  catalogId: string | null;
  description: string;
  quantity: number;
  reason: string;
  priority: DraftPriority | null;
  optional: boolean;
  groupKey: string;
  groupLabel: string;
  inspectionItemId: string | null;
  /** Ligne « À chiffrer » (prix 0) : bloque l'envoi tant qu'elle n'est pas complétée. */
  toPrice: boolean;
}

export interface QuoteDraftResult {
  lines: QuoteDraftLine[];
  /** Nombre de lignes rejetées (catalogId hors liste candidate). */
  rejected: number;
  unmatched: string[];
}

function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

function needFor(needs: DraftNeed[], label: string | null | undefined): DraftNeed | undefined {
  if (!label) return undefined;
  const target = fold(label);
  return (
    needs.find((n) => fold(n.label) === target) ??
    needs.find((n) => fold(n.label).includes(target) || target.includes(fold(n.label)))
  );
}

function placeholder(need: DraftNeed, index: number): QuoteDraftLine {
  return {
    key: `unmatched:${index}`,
    kind: "PART",
    catalogId: null,
    description: `${UNPRICED_PREFIX} : ${need.label.toLowerCase()} (non trouvée au catalogue)`,
    quantity: 1,
    reason: reasonOf(need),
    priority: need.priority,
    optional: need.priority === "WATCH",
    groupKey: need.key,
    groupLabel: need.label,
    inspectionItemId: need.inspectionItemId ?? null,
    toPrice: true,
  };
}

function reasonOf(need: DraftNeed): string {
  if (need.key === "complaint") return `Doléance : ${need.label}`;
  return `Inspection : ${need.label}${need.measurement ? ` ${need.measurement}` : ""}`;
}

/**
 * RG-M17-13 — lignes du brouillon à partir de la sortie IA : `catalogId` absent de la liste
 * candidate rejeté, quantité MO = temps barème, WATCH optionnel, besoins non couverts → ligne
 * « À chiffrer » à prix 0.
 */
export function buildQuoteDraftLines(input: {
  aiLines: AiDraftLine[];
  candidates: DraftCandidate[];
  needs: DraftNeed[];
}): QuoteDraftResult {
  const byId = new Map(input.candidates.map((c) => [c.catalogId, c]));
  const lines: QuoteDraftLine[] = [];
  const covered = new Set<string>();
  const seen = new Set<string>();
  let rejected = 0;
  input.aiLines.forEach((line, index) => {
    const need = needFor(input.needs, line.need);
    const priority = line.priority ?? need?.priority ?? null;
    if (line.catalogId === null) {
      const target: DraftNeed = need ?? {
        key: "complaint",
        label: line.need?.trim() || line.reason,
        priority,
      };
      if (covered.has(target.key) && need) return;
      lines.push({ ...placeholder(target, index), reason: line.reason || reasonOf(target) });
      covered.add(target.key);
      return;
    }
    const candidate = byId.get(line.catalogId);
    if (!candidate || candidate.kind !== line.kind) {
      rejected += 1;
      return;
    }
    if (seen.has(candidate.catalogId)) return;
    seen.add(candidate.catalogId);
    const quantity =
      candidate.kind === "LABOR"
        ? (candidate.standardHours ?? 1)
        : Math.min(100, Math.max(0.1, Number.isFinite(line.quantity) ? line.quantity : 1));
    if (need) covered.add(need.key);
    lines.push({
      key: `${candidate.kind}:${candidate.catalogId}`,
      kind: candidate.kind,
      catalogId: candidate.catalogId,
      description: candidate.name,
      quantity: Math.round(quantity * 100) / 100,
      reason: line.reason.trim() || (need ? reasonOf(need) : ""),
      priority,
      optional: line.optional || priority === "WATCH",
      groupKey: need?.key ?? `line:${candidate.catalogId}`,
      groupLabel: need?.label ?? candidate.name,
      inspectionItemId: need?.inspectionItemId ?? null,
      toPrice: false,
    });
  });
  const unmatched: string[] = [];
  input.needs.forEach((need, index) => {
    if (need.key === "complaint" || need.priority === null || covered.has(need.key)) return;
    lines.push(placeholder(need, 1000 + index));
    unmatched.push(need.label);
  });
  for (const line of lines)
    if (line.toPrice && !unmatched.includes(line.groupLabel)) unmatched.push(line.groupLabel);
  return { lines, rejected, unmatched };
}

/** RG-M17-08 — repli sans IA : lignes recommandées des `InspectionItem`. */
export function fallbackQuoteDraftLines(input: {
  needs: DraftNeed[];
  products: DraftCatalogProduct[];
  labor: DraftCatalogLabor[];
}): QuoteDraftResult {
  const products = new Map(input.products.map((p) => [p.id, p]));
  const labor = new Map(input.labor.map((l) => [l.id, l]));
  const aiLines: AiDraftLine[] = [];
  const candidates: DraftCandidate[] = [];
  for (const need of input.needs) {
    for (const id of need.recommendedLaborIds ?? []) {
      const op = labor.get(id);
      if (!op) continue;
      candidates.push({
        catalogId: op.id,
        kind: "LABOR",
        name: op.name,
        category: op.category ?? null,
        standardHours: op.standardHours,
      });
      aiLines.push({
        kind: "LABOR",
        catalogId: op.id,
        quantity: op.standardHours,
        reason: reasonOf(need),
        priority: need.priority,
        optional: need.priority === "WATCH",
        need: need.label,
      });
    }
    for (const id of need.recommendedProductIds ?? []) {
      const p = products.get(id);
      if (!p) continue;
      candidates.push({
        catalogId: p.id,
        kind: "PART",
        name: p.name,
        category: p.category ?? null,
      });
      aiLines.push({
        kind: "PART",
        catalogId: p.id,
        quantity: 1,
        reason: reasonOf(need),
        priority: need.priority,
        optional: need.priority === "WATCH",
        need: need.label,
      });
    }
  }
  return buildQuoteDraftLines({ aiLines, candidates, needs: input.needs });
}

/** Ligne « À chiffrer » non complétée (prix 0) : interdit l'envoi du devis (US-M17-03). */
export function isUnpricedPlaceholder(line: { description: string; unitPrice: number }): boolean {
  return line.unitPrice === 0 && line.description.trim().startsWith(UNPRICED_PREFIX);
}
