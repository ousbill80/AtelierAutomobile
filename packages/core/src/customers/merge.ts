// RG-M02-08 — logique pure de fusion (choix de champs, union des tags, consentement le
// plus restrictif, collisions de dedupeKey). La transaction elle-même (réaffectation des
// entités liées) vit dans le routeur tRPC, qui s'appuie sur ces fonctions pour décider.

export interface ConsentState {
  remindersConsent: boolean;
  marketingConsent: boolean;
  doNotRemind: boolean;
  optedOutAt: Date | null;
}

/** Retient le consentement le plus restrictif : si l'un des deux est désinscrit, le résultat l'est. */
export function mergeConsent(a: ConsentState, b: ConsentState): ConsentState {
  return {
    remindersConsent: a.remindersConsent && b.remindersConsent,
    marketingConsent: a.marketingConsent && b.marketingConsent,
    doNotRemind: a.doNotRemind || b.doNotRemind,
    optedOutAt: a.optedOutAt ?? b.optedOutAt ?? null,
  };
}

export function mergeTags(a: readonly string[], b: readonly string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

export type FieldChoice = "source" | "target";

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Valeur par défaut à l'écran de fusion : la valeur non vide la plus récente — ici, la cible
 * sauf si elle est vide et que la source est renseignée. */
export function defaultFieldChoice(sourceValue: unknown, targetValue: unknown): FieldChoice {
  if (isEmpty(targetValue) && !isEmpty(sourceValue)) return "source";
  return "target";
}

export function resolveField<T>(
  choice: FieldChoice | undefined,
  sourceValue: T,
  targetValue: T,
): T {
  const effective = choice ?? defaultFieldChoice(sourceValue, targetValue);
  return effective === "source" ? sourceValue : targetValue;
}

export interface DedupeKeyed {
  id: string;
  dedupeKey: string;
}

/** En cas de collision de dedupeKey après fusion, la relance de la source est annulée. */
export function resolveDedupeKeyCollisions<T extends DedupeKeyed>(
  sourceReminders: readonly T[],
  targetReminders: readonly T[],
): { keep: T[]; cancel: T[] } {
  const seenKeys = new Set(targetReminders.map((r) => r.dedupeKey));
  const keep: T[] = [];
  const cancel: T[] = [];
  for (const reminder of sourceReminders) {
    if (seenKeys.has(reminder.dedupeKey)) {
      cancel.push(reminder);
    } else {
      keep.push(reminder);
      seenKeys.add(reminder.dedupeKey);
    }
  }
  return { keep, cancel };
}
