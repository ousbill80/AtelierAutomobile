// M15 RG-M15-20 — application des limites de plan. Fonctions pures : l'appelant compte l'usage
// (membres actifs, sites actifs, compteur mensuel…) et décide quoi faire du verdict.

import { DomainError } from "../errors";
import type { PlanDefinition, PlanQuotas, PlanTier } from "./plans";
import { PLAN_TIERS, PLAN_CATALOG } from "./plans";

/** Limites vérifiées avant création (dénombrables) ou avant consommation (mensuelles). */
export type LimitKey =
  | "activeMembers"
  | "activeSites"
  | "dataSources"
  | "apiKeys"
  | "autoMessagesPerMonth"
  | "aiCreditsPerMonth"
  | "storageBytes";

export const MONTHLY_LIMIT_KEYS: readonly LimitKey[] = [
  "autoMessagesPerMonth",
  "aiCreditsPerMonth",
];

/** Seuil d'alerte : notification au gérant à 80 % (RG-M15-20). */
export const USAGE_WARNING_RATIO = 0.8;

export type UsageLevel = "OK" | "WARNING" | "REACHED";

export interface LimitCheck {
  allowed: boolean;
  key: LimitKey;
  limit: number | null;
  used: number;
  /** Usage après l'incrément demandé. */
  next: number;
  level: UsageLevel;
}

/** Niveau d'usage d'une jauge (`null` = illimité → toujours OK). */
export function usageLevel(used: number, limit: number | null): UsageLevel {
  if (limit === null) return "OK";
  if (used >= limit) return "REACHED";
  if (used >= Math.ceil(limit * USAGE_WARNING_RATIO)) return "WARNING";
  return "OK";
}

/**
 * `checkLimit(plan, key, used, increment)` — vrai si `used + increment` reste dans la limite.
 * Un incrément nul ou négatif (désactivation, suppression) est toujours autorisé.
 */
export function checkLimit(
  plan: PlanDefinition,
  key: LimitKey,
  used: number,
  increment = 1,
): LimitCheck {
  const limit = plan.quotas[key as keyof PlanQuotas] as number | null;
  const next = used + increment;
  const allowed = increment <= 0 || limit === null || next <= limit;
  return { allowed, key, limit, used, next, level: usageLevel(next, limit) };
}

/** A franchi le seuil des 80 % avec cet incrément (pour notifier une seule fois). */
export function crossedWarningThreshold(
  limit: number | null,
  before: number,
  after: number,
): boolean {
  if (limit === null || limit === 0) return false;
  const threshold = Math.ceil(limit * USAGE_WARNING_RATIO);
  return before < threshold && after >= threshold;
}

/** Plus petit plan dont la limite couvre `needed` (pour le message « Passez à l'offre … »). */
export function smallestPlanAllowing(key: LimitKey, needed: number): PlanTier | null {
  for (const tier of PLAN_TIERS) {
    const limit = PLAN_CATALOG[tier].quotas[key as keyof PlanQuotas] as number | null;
    if (limit === null || needed <= limit) return tier;
  }
  return null;
}

const LIMIT_NOUNS: Record<LimitKey, [singular: string, plural: string]> = {
  activeMembers: ["utilisateur actif", "utilisateurs actifs"],
  activeSites: ["site", "sites"],
  dataSources: ["source de synchronisation", "sources de synchronisation"],
  apiKeys: ["clé API", "clés API"],
  autoMessagesPerMonth: ["message automatique par mois", "messages automatiques par mois"],
  aiCreditsPerMonth: ["crédit IA par mois", "crédits IA par mois"],
  storageBytes: ["octet de stockage", "octets de stockage"],
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n).replace(/\u202f|\u00a0/g, " ");
}

/** Message français de RG-M15-20 : « Votre offre STARTER permet 1 site. Passez à l'offre PRO. » */
export function planLimitMessage(plan: PlanDefinition, check: LimitCheck): string {
  const [singular, plural] = LIMIT_NOUNS[check.key];
  const limit = check.limit ?? 0;
  const noun = limit > 1 ? plural : singular;
  const upgrade = smallestPlanAllowing(check.key, check.next);
  const suffix =
    upgrade && upgrade !== plan.tier
      ? ` Passez à l'offre ${upgrade}.`
      : " Contactez l'équipe AtelierOS.";
  return `Votre offre ${plan.tier} permet ${formatCount(limit)} ${noun}.${suffix}`;
}

/** Lève `PLAN_LIMIT_REACHED` (DomainError) si la limite est dépassée. */
export function assertWithinLimit(
  plan: PlanDefinition,
  key: LimitKey,
  used: number,
  increment = 1,
): LimitCheck {
  const check = checkLimit(plan, key, used, increment);
  if (!check.allowed) {
    throw new DomainError("PLAN_LIMIT_REACHED", planLimitMessage(plan, check), {
      key,
      limit: check.limit,
      used,
      plan: plan.tier,
      suggestedPlan: smallestPlanAllowing(key, check.next),
    });
  }
  return check;
}

export interface DowngradeImpact {
  key: LimitKey;
  used: number;
  limit: number;
  /** Éléments au-delà de la limite, qui deviennent en lecture seule (rien n'est supprimé). */
  excess: number;
}

/**
 * Rétrogradation (RG-M15-20) : liste des limites dénombrables dépassées par l'usage actuel.
 * Rien n'est supprimé ; l'appelant affiche l'impact et le gérant choisit quoi désactiver.
 */
export function downgradeImpact(
  target: PlanDefinition,
  usage: Partial<Record<LimitKey, number>>,
): DowngradeImpact[] {
  const impacts: DowngradeImpact[] = [];
  for (const [key, used] of Object.entries(usage) as [LimitKey, number][]) {
    if (MONTHLY_LIMIT_KEYS.includes(key)) continue;
    const limit = target.quotas[key as keyof PlanQuotas] as number | null;
    if (limit !== null && used > limit) {
      impacts.push({ key, used, limit, excess: used - limit });
    }
  }
  return impacts;
}
