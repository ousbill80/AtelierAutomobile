export type MergeSide = "source" | "target";

export interface MergeFieldInput {
  sourceValue: unknown;
  targetValue: unknown;
}

export interface ConsentState {
  remindersConsent: boolean;
  marketingConsent: boolean;
  doNotRemind: boolean;
  optedOutAt: Date | null;
}

export interface MergePlanInput {
  /** Champs candidats à la fusion, valeur de chaque côté. */
  fields: Record<string, MergeFieldInput>;
  /** Choix explicite fait à l'écran pour un champ donné (sinon, règle par défaut). */
  choices?: Record<string, MergeSide>;
  sourceUpdatedAt: Date;
  targetUpdatedAt: Date;
  sourceTags: string[];
  targetTags: string[];
  sourceConsent: ConsentState;
  targetConsent: ConsentState;
  /**
   * `dedupeKey` des relances en attente de la source, déjà recalculés comme si
   * `customerId` pointait vers la cible (cf. algorithme M10). La cible est
   * inchangée : on détecte les collisions avec ses relances existantes.
   */
  sourceReminderDedupeKeys: string[];
  targetReminderDedupeKeys: string[];
}

export interface MergePlanResult {
  fields: Record<string, unknown>;
  tags: string[];
  consent: ConsentState;
  /** `dedupeKey` de relances de la source à annuler (`CANCELLED`, « doublon fusionné »). */
  cancelledSourceReminderDedupeKeys: string[];
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function pickEarliestNonNull(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * RG-M02-08 — fusion de deux clients (ou véhicules) : résolution champ par
 * champ (choix explicite sinon valeur non vide la plus récente), union des
 * tags, consentement le plus restrictif, et détection des collisions de
 * `dedupeKey` de relances après recalcul. Ne fait aucun effet de bord : le
 * routeur applique ce plan dans une transaction (réaffectations, audit…).
 */
export function mergePlan(input: MergePlanInput): MergePlanResult {
  const sourceIsNewer = input.sourceUpdatedAt.getTime() > input.targetUpdatedAt.getTime();

  const fields: Record<string, unknown> = {};
  for (const [name, { sourceValue, targetValue }] of Object.entries(input.fields)) {
    const choice = input.choices?.[name];
    if (choice === "source") {
      fields[name] = sourceValue;
      continue;
    }
    if (choice === "target") {
      fields[name] = targetValue;
      continue;
    }
    const preferred = sourceIsNewer ? sourceValue : targetValue;
    const fallback = sourceIsNewer ? targetValue : sourceValue;
    fields[name] = isEmptyValue(preferred) ? fallback : preferred;
  }

  const tags = Array.from(new Set([...input.targetTags, ...input.sourceTags]));

  const consent: ConsentState = {
    remindersConsent: input.sourceConsent.remindersConsent && input.targetConsent.remindersConsent,
    marketingConsent: input.sourceConsent.marketingConsent && input.targetConsent.marketingConsent,
    doNotRemind: input.sourceConsent.doNotRemind || input.targetConsent.doNotRemind,
    optedOutAt: pickEarliestNonNull(input.sourceConsent.optedOutAt, input.targetConsent.optedOutAt),
  };

  const targetKeys = new Set(input.targetReminderDedupeKeys);
  const cancelledSourceReminderDedupeKeys = input.sourceReminderDedupeKeys.filter((key) =>
    targetKeys.has(key),
  );

  return { fields, tags, consent, cancelledSourceReminderDedupeKeys };
}
