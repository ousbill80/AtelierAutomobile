// RG-M04-12 — détection d'un retour probable (30 jours / 1 000 km, catégorie commune).

/** Catégories d'opération reconnues dans les doléances (mots-clés simples, sans IA). */
const CATEGORY_KEYWORDS: ReadonlyArray<[string, RegExp]> = [
  ["Freinage", /frein|plaquette|disque|abs/i],
  ["Entretien", /vidange|huile|r[ée]vision|entretien|filtre/i],
  ["Climatisation", /clim|climatisation|air conditionn/i],
  ["Pneumatiques", /pneu|crevaison|parall[ée]lisme|g[ée]om[ée]trie|[ée]quilibrage/i],
  ["Électricité", /batterie|[ée]lectri|alternateur|d[ée]marreur|voyant|phare|ampoule/i],
  ["Transmission", /embrayage|bo[iî]te|cardan|transmission|tac-tac/i],
  ["Suspension/Direction", /amortisseur|suspension|rotule|direction|silent/i],
  ["Moteur", /moteur|courroie|distribution|surchauffe|fum[ée]e|injecteur|turbo/i],
  ["Carrosserie", /carrosserie|rayure|choc|peinture|t[ôo]le|pare-choc/i],
  ["Échappement", /[ée]chappement|pot|silencieux/i],
];

export function complaintCategories(text: string | null | undefined): string[] {
  if (!text) return [];
  return CATEGORY_KEYWORDS.filter(([, re]) => re.test(text)).map(([category]) => category);
}

export const COMEBACK_MAX_DAYS = 30;
export const COMEBACK_MAX_KM = 1_000;

export interface ComebackCandidateInput {
  previousDeliveredAt: Date;
  previousMileage: number | null;
  previousCategories: readonly string[];
  now: Date;
  mileage: number | null;
  categories: readonly string[];
}

export function isProbableComeback(input: ComebackCandidateInput): boolean {
  const days = (input.now.getTime() - input.previousDeliveredAt.getTime()) / 86_400_000;
  if (days < 0 || days > COMEBACK_MAX_DAYS) return false;
  if (input.previousMileage != null && input.mileage != null) {
    if (input.mileage - input.previousMileage > COMEBACK_MAX_KM) return false;
  }
  return input.categories.some((c) => input.previousCategories.includes(c));
}
