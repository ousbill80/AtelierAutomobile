import {
  type LimitKey,
  type PlanDefinition,
  type PlanTier,
  type UsageMetric,
  assertWithinLimit,
  resolvePlan,
  usagePeriod,
} from "@atelieros/core";
import { aiCreditsUsedThisMonth } from "./ai";
import { adminDb } from "./client";
import { db } from "./tenant";

// M15 RG-M15-19/20 — plan effectif d'une organisation, compteurs d'usage et contrôle des
// limites avant création. Partagé par apps/web (routeurs) et apps/worker (relances).

export interface OrgPlanContext {
  organizationId: string;
  plan: PlanDefinition;
  timezone: string;
}

/** Organization est la racine du tenant : lue par id via adminDb (pas de organizationId). */
export async function loadOrgPlan(organizationId: string): Promise<OrgPlanContext> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { plan: true, planOverrides: true, timezone: true },
  });
  return {
    organizationId,
    plan: resolvePlan(org.plan as PlanTier, org.planOverrides),
    timezone: org.timezone,
  };
}

export async function getMonthlyUsage(
  organizationId: string,
  metric: UsageMetric,
  period: string,
): Promise<number> {
  const row = await db
    .forTenant({ organizationId })
    .usageCounter.findFirst({ where: { metric, period }, select: { used: true } });
  return row?.used ?? 0;
}

/** Incrément atomique du compteur mensuel ; renvoie l'usage avant/après. */
export async function incrementMonthlyUsage(
  organizationId: string,
  metric: UsageMetric,
  period: string,
  by = 1,
): Promise<{ before: number; after: number }> {
  const row = await db.forTenant({ organizationId }).usageCounter.upsert({
    where: { organizationId_metric_period: { organizationId, metric, period } },
    create: { organizationId, metric, period, used: by },
    update: { used: { increment: by } },
    select: { used: true },
  });
  return { before: row.used - by, after: row.used };
}

/** Usage courant d'une limite (dénombrable ou mensuelle). */
export async function countUsage(
  organizationId: string,
  key: LimitKey,
  now: Date,
  timezone: string,
): Promise<number> {
  const tx = db.forTenant({ organizationId });
  switch (key) {
    case "activeMembers":
      return tx.membership.count({ where: { isActive: true } });
    case "activeSites":
      return tx.site.count({ where: { isActive: true } });
    case "dataSources":
      return tx.dataSource.count({ where: { isActive: true } });
    case "apiKeys":
      return tx.apiKey.count({ where: { revokedAt: null } });
    case "autoMessagesPerMonth":
      return getMonthlyUsage(organizationId, "auto_messages", usagePeriod(now, timezone));
    case "aiCreditsPerMonth":
      return aiCreditsUsedThisMonth(organizationId, now, timezone);
    case "storageBytes": {
      const agg = await tx.attachment.aggregate({ _sum: { size: true } });
      return agg._sum.size ?? 0;
    }
  }
}

/**
 * RG-M15-20 — `checkLimit` appelé avant création : lève `PLAN_LIMIT_REACHED` (DomainError)
 * avec le message français de M15 si `increment` dépasse la limite du plan effectif.
 */
export async function enforcePlanLimit(
  organizationId: string,
  key: LimitKey,
  now: Date,
  increment = 1,
): Promise<void> {
  const ctx = await loadOrgPlan(organizationId);
  const used = await countUsage(organizationId, key, now, ctx.timezone);
  assertWithinLimit(ctx.plan, key, used, increment);
}

export const GAUGE_KEYS: readonly LimitKey[] = [
  "activeMembers",
  "activeSites",
  "autoMessagesPerMonth",
  "aiCreditsPerMonth",
  "storageBytes",
  "dataSources",
  "apiKeys",
];

export async function computePlanUsage(
  organizationId: string,
  now: Date,
): Promise<{ ctx: OrgPlanContext; usage: Record<LimitKey, number> }> {
  const ctx = await loadOrgPlan(organizationId);
  const entries = await Promise.all(
    GAUGE_KEYS.map(async (key) => [key, await countUsage(organizationId, key, now, ctx.timezone)]),
  );
  return { ctx, usage: Object.fromEntries(entries) as Record<LimitKey, number> };
}
