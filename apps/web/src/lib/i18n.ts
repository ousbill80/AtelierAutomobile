import fr from "../../messages/fr.json";

type Messages = typeof fr;

/**
 * Traduction minimaliste (clé pointée → libellé) : l'interface est en
 * français uniquement (CLAUDE.md § Langue), tous les libellés vivent dans
 * `messages/fr.json`, jamais en dur dans les composants.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const parts = key.split(".");
  let value: unknown = fr satisfies Messages;
  for (const part of parts) {
    if (typeof value !== "object" || value === null) return key;
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== "string") return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? ""));
}
