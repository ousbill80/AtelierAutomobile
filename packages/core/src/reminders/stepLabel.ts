// Palier d'une relance en langage clair : « J-30 » → 30 jours avant l'échéance, « J+3 » →
// 3 jours après, « J0 » → le jour même, « MANUAL » → relance envoyée à la main. Le libellé
// final (français) est construit par l'interface à partir de ce résultat.

export type StepTiming =
  | { kind: "before"; days: number }
  | { kind: "on" }
  | { kind: "after"; days: number }
  | { kind: "manual" }
  | { kind: "promise" }
  | { kind: "other"; key: string };

export function describeStep(stepKey: string): StepTiming {
  if (stepKey === "MANUAL") return { kind: "manual" };
  if (stepKey === "PROMISE_BROKEN") return { kind: "promise" };
  const match = /^J([+-])?(\d+)$/i.exec(stepKey.trim());
  if (!match) return { kind: "other", key: stepKey };
  const days = Number(match[2]);
  if (days === 0) return { kind: "on" };
  return match[1] === "-" ? { kind: "before", days } : { kind: "after", days };
}
