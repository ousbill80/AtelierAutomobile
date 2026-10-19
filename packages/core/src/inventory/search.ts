// US-M07-01 / US-M07-14 — recherche catalogue et lecture des codes-barres.

/** Mots d'une recherche libre (« filtre huile corolla » → ["filtre", "huile", "corolla"]). */
export function tokenizeProductQuery(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    .slice(0, 6);
}

/** EAN-8, UPC-A, EAN-13, GTIN-14 : uniquement des chiffres. */
export function looksLikeBarcode(q: string): boolean {
  return /^\d{8,14}$/.test(q.trim());
}

/** Clé de contrôle EAN-8/EAN-13 valide. */
export function isValidEan(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Douchette USB : saisie clavier rapide (< 50 ms entre touches), au moins 6 caractères. */
export function isScannerBurst(keyTimestamps: number[], maxGapMs = 50, minLength = 6): boolean {
  if (keyTimestamps.length < minLength) return false;
  for (let i = 1; i < keyTimestamps.length; i++) {
    if (keyTimestamps[i]! - keyTimestamps[i - 1]! >= maxGapMs) return false;
  }
  return true;
}

/** Normalise une référence pour comparaison (SKU, OEM) : majuscules, sans espaces. */
export function normalizeReference(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}
