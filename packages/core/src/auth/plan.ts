// RG-M01-13 — Limites de plan. Les Membership désactivées / sites désactivés ne comptent pas.

export const PLAN_TIERS = ["STARTER", "PRO", "NETWORK"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export interface PlanLimits {
  maxActiveMembers: number | null;
  maxSites: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  STARTER: { maxActiveMembers: 5, maxSites: 1 },
  PRO: { maxActiveMembers: 15, maxSites: 3 },
  NETWORK: { maxActiveMembers: null, maxSites: null },
};

export function canAddSite(plan: PlanTier, currentActiveSiteCount: number): boolean {
  const limit = PLAN_LIMITS[plan].maxSites;
  return limit === null || currentActiveSiteCount < limit;
}

export function canAddMember(plan: PlanTier, currentActiveMemberCount: number): boolean {
  const limit = PLAN_LIMITS[plan].maxActiveMembers;
  return limit === null || currentActiveMemberCount < limit;
}
