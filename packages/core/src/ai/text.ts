// M17 — utilitaires de texte : distance d'édition (RG-M17-06, `AiInteraction.editDistance`)
// et vérification des chiffres de l'assistant (RG-M17-20).

/** Distance de Levenshtein (insertion, suppression, substitution), en O(n·m) mémoire O(m). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Nombres cités dans un texte, normalisés : « 1 240 000 FCFA » → 1240000, « 38 jours » → 38,
 * « 0,9 » → 0.9. Les dates (15/10, 2026-10-15) et numéros de documents (FAC-2026-000287) sont
 * ignorés : ils viennent des identifiants, pas de calculs.
 */
export function extractNumbers(text: string): number[] {
  const cleaned = text
    .replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, " ") // FAC-2026-000287, OR-YOP-2026-00042
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ") // 15/10, 15/10/2026
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, " ") // 08:30, 19h00
    .replace(/\[(?:TEL|EMAIL)_\d+\]/g, " ");
  const out: number[] = [];
  // Groupes de milliers séparés par espace (y compris insécable) : 1 240 000.
  const re = /\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
  for (const match of cleaned.matchAll(re)) {
    const value = Number(match[0].replace(/[  ]/g, "").replace(",", "."));
    if (Number.isFinite(value)) out.push(value);
  }
  return out;
}

/**
 * RG-M17-20 — tout nombre de la réponse doit apparaître dans un résultat d'outil. Les petits
 * entiers (≤ 10 : « 3 factures », « 2 phrases ») sont tolérés s'ils sont des comptes de lignes.
 * Retourne les nombres non justifiés (vide = réponse acceptée).
 */
export function unverifiedNumbers(answer: string, toolResults: readonly unknown[]): number[] {
  const known = new Set<number>();
  const visit = (value: unknown) => {
    if (typeof value === "number") known.add(value);
    else if (typeof value === "string") for (const n of extractNumbers(value)) known.add(n);
    else if (Array.isArray(value)) {
      known.add(value.length);
      value.forEach(visit);
    } else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  toolResults.forEach(visit);
  return extractNumbers(answer).filter((n) => !known.has(n) && !(Number.isInteger(n) && n <= 10));
}
