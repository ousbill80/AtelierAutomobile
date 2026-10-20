import { TRPCError } from "@trpc/server";
import { isDomainError, type LimitKey } from "@atelieros/core";
import { enforcePlanLimit } from "@atelieros/db";

/**
 * M15 RG-M15-20 — limite du plan vérifiée côté serveur avant toute création (membre, site,
 * source, clé API). `PLAN_LIMIT_REACHED` est exposé au client via `data.domainCode`.
 */
export async function assertPlanLimit(
  organizationId: string,
  key: LimitKey,
  increment = 1,
  now: Date = new Date(),
): Promise<void> {
  try {
    await enforcePlanLimit(organizationId, key, now, increment);
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message, cause: error });
    }
    throw error;
  }
}
