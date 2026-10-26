// M18 §9 — `treasury.sync` (toutes les 15 min) : projette dans le grand livre de trésorerie ce
// que la caisse et la facturation ont produit (RG-M18-03), pour les organisations qui ont déjà
// une trésorerie. La projection est idempotente : les écrans la refont aussi à la lecture.
import { systemClock, type Clock } from "@atelieros/core";
import { adminDb, db, syncTreasuryLedger } from "@atelieros/db";
import { logger } from "../logger";

export async function syncOrganizationTreasury(organizationId: string, now: Date): Promise<number> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const tenantDb = db.forTenant({ organizationId });
  const result = await tenantDb.transaction((tx) =>
    syncTreasuryLedger(tx, { organizationId, timeZone: org.timezone, now }),
  );
  return result.created;
}

export async function processTreasurySyncJob(clock: Clock = systemClock): Promise<number> {
  const organizations = await adminDb.treasuryAccount.findMany({
    distinct: ["organizationId"],
    select: { organizationId: true },
  });
  let total = 0;
  for (const { organizationId } of organizations) {
    try {
      total += await syncOrganizationTreasury(organizationId, clock.now());
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "treasury.sync : échec sur une organisation, passage à la suivante",
      );
    }
  }
  return total;
}
