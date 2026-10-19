/**
 * RG-M13-19 à 22 — politiques de mise à jour incrémentale. Fonctions pures :
 * étant donné un enregistrement existant et les champs importés, calculent
 * le résultat (create/update/unchanged) et le patch à appliquer, sans jamais
 * toucher la base.
 */

export type ImportPolicy = "CREATE_ONLY" | "UPSERT" | "UPSERT_OVERWRITE";

export type RowOutcome = "create" | "update" | "unchanged" | "skip";

export interface MergeResult {
  outcome: RowOutcome;
  /** Champs à écrire (sous-ensemble de `incoming`), déjà filtrés selon la politique. */
  patch: Record<string, unknown>;
}

/**
 * Champs saisis dans AtelierOS qui ne doivent **jamais** être écrasés par un
 * import, quelle que soit la politique (RG-M13-19).
 */
export const NEVER_OVERWRITTEN_FIELDS: readonly string[] = [
  "remindersConsent",
  "optedOutAt",
  "doNotRemind",
  "preferredChannel",
];

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * RG-M13-19 — fusionne les champs importés dans un enregistrement existant
 * selon la politique du job. Pas d'enregistrement existant → `create`. Hash
 * canonique identique (calculé par l'appelant via `computeRowHash`) → appelé
 * séparément en amont (voir `outcomeForHash`), cette fonction suppose déjà
 * qu'une écriture est nécessaire.
 */
export function mergeFields(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
  policy: ImportPolicy,
): MergeResult {
  if (!existing) {
    return { outcome: "create", patch: { ...incoming } };
  }

  if (policy === "CREATE_ONLY") {
    return { outcome: "skip", patch: {} };
  }

  const patch: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(incoming)) {
    if (NEVER_OVERWRITTEN_FIELDS.includes(field)) continue;

    // UPSERT (défaut) : un champ vide dans le fichier n'écrase jamais une
    // valeur existante.
    if (policy === "UPSERT" && isBlank(value)) continue;

    // Valeur identique à l'existant : aucune écriture réelle nécessaire.
    if (existing[field] === value) continue;

    patch[field] = value;
  }

  return { outcome: Object.keys(patch).length > 0 ? "update" : "unchanged", patch };
}

/**
 * RG-M13-19 — détermine si une ligne est "inchangée" par comparaison de hash
 * canonique, avant même d'appliquer `mergeFields`.
 */
export function outcomeForHash(
  existingHash: string | null,
  incomingHash: string,
): "unchanged" | "changed" {
  return existingHash === incomingHash ? "unchanged" : "changed";
}

export interface BalanceChangeResult {
  kind: "increase" | "decrease" | "unchanged";
  delta: number;
  error?: string;
}

/**
 * RG-M13-21 — une baisse de solde génère un paiement de reprise ; une hausse
 * est une erreur (sauf `UPSERT_OVERWRITE`, où elle est acceptée).
 */
export function computeBalanceChange(
  existingBalance: number,
  importedBalance: number,
  policy: ImportPolicy,
  invoiceLabel: string,
): BalanceChangeResult {
  const delta = existingBalance - importedBalance;

  if (delta > 0) {
    return { kind: "decrease", delta };
  }

  if (delta < 0) {
    if (policy === "UPSERT_OVERWRITE") {
      return { kind: "increase", delta };
    }
    return {
      kind: "increase",
      delta,
      error: `Le solde de ${invoiceLabel} a augmenté (avoir annulé ?) : vérifiez dans votre logiciel.`,
    };
  }

  return { kind: "unchanged", delta: 0 };
}
