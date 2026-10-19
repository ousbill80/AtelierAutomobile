/**
 * Rendu des gabarits de message (M10 §9/Annexe A) : substitution de variables `{{chemin.pointe}}`
 * dans le corps d'un `MessageTemplate`. Fonction pure, testée — la résolution des valeurs (date au
 * format `dd/MM/yyyy`, montant FCFA…) est faite par l'appelant *avant* l'appel, pour que ce module
 * n'ait aucune dépendance au fuseau horaire ou au formatage monétaire d'une organisation donnée.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export type TemplateVariables = Record<string, string | number | null | undefined>;

/**
 * Remplace chaque `{{chemin}}` trouvé dans `body` par `variables[chemin]`. Un placeholder sans
 * valeur correspondante (clé absente ou `null`/`undefined`) est laissé tel quel dans le texte
 * rendu : une variable manquante doit rester visible (donnée incomplète), jamais silencieusement
 * effacée.
 */
export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body.replace(PLACEHOLDER, (match, path: string) => {
    const value = variables[path];
    return value === null || value === undefined ? match : String(value);
  });
}

/** Chemins `{{…}}` référencés par un gabarit, sans doublons, dans l'ordre d'apparition. */
export function extractTemplateVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER)) {
    const path = match[1];
    if (path) seen.add(path);
  }
  return [...seen];
}
