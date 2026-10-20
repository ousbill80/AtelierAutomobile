// RG-M01-13 — Limites de plan. Les Membership désactivées / sites désactivés ne comptent pas.
// Valeurs lues dans le catalogue unique `billing/plans.ts` (M15 RG-M15-19, arbitrage A12).

import { PLAN_CATALOG, PLAN_TIERS, type PlanTier } from "../billing/plans";

export { PLAN_TIERS };
export type { PlanTier };

export interface PlanLimits {
  maxActiveMembers: number | null;
  maxSites: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = Object.fromEntries(
  PLAN_TIERS.map((tier) => [
    tier,
    {
      maxActiveMembers: PLAN_CATALOG[tier].quotas.activeMembers,
      maxSites: PLAN_CATALOG[tier].quotas.activeSites,
    },
  ]),
) as Record<PlanTier, PlanLimits>;

export function canAddSite(plan: PlanTier, currentActiveSiteCount: number): boolean {
  const limit = PLAN_LIMITS[plan].maxSites;
  return limit === null || currentActiveSiteCount < limit;
}

export function canAddMember(plan: PlanTier, currentActiveMemberCount: number): boolean {
  const limit = PLAN_LIMITS[plan].maxActiveMembers;
  return limit === null || currentActiveMemberCount < limit;
}
