/**
 * RG-M13-19 — hash canonique d'une ligne importée : sha256 du JSON canonique
 * des champs mappés normalisés. Les clés sont triées pour que l'ordre des
 * colonnes du fichier n'influence jamais le hash.
 */
export function canonicalize(fields: Record<string, unknown>): string {
  const sortedKeys = Object.keys(fields).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = fields[key];
  }
  return JSON.stringify(sorted);
}

export async function computeRowHash(fields: Record<string, unknown>): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(fields));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
