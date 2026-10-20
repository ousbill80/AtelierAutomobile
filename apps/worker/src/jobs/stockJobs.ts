// M07 §9 — jobs du stock. Chaque organisation en mode FULL est traitée isolément (une erreur
// n'arrête pas les autres) ; la logique vit dans `@atelieros/db` (services stock) et
// `@atelieros/core` (règles pures). Les organisations en REMINDERS_ONLY n'ont pas de stock.
import { systemClock, type Clock } from "@atelieros/core";
import {
  adminDb,
  runIntegrityCheck,
  runLatePurchaseAlerts,
  runReorderSuggestions,
} from "@atelieros/db";
import { logger } from "../logger";

async function forEachStockOrganization(
  jobName: string,
  fn: (organizationId: string) => Promise<unknown>,
): Promise<number> {
  const organizations = await adminDb.organization.findMany({
    where: { operatingMode: "FULL" },
    select: { id: true },
  });
  let processed = 0;
  for (const org of organizations) {
    try {
      await fn(org.id);
      processed++;
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        `${jobName} : échec sur une organisation, passage à la suivante`,
      );
    }
  }
  return processed;
}

export function processStockReorderSuggestionsJob(clock: Clock = systemClock): Promise<number> {
  return forEachStockOrganization("stock.reorder_suggestions", (id) =>
    runReorderSuggestions(id, clock.now()),
  );
}

export function processStockIntegrityCheckJob(clock: Clock = systemClock): Promise<number> {
  return forEachStockOrganization("stock.integrity_check", async (id) => {
    const mismatches = await runIntegrityCheck(id, clock.now());
    if (mismatches.length > 0) {
      logger.error({ organizationId: id, mismatches }, "stock.integrity_check : écarts détectés");
    }
  });
}

export function processPurchaseLateAlertsJob(clock: Clock = systemClock): Promise<number> {
  return forEachStockOrganization("purchase.late_alerts", (id) =>
    runLatePurchaseAlerts(id, clock.now()),
  );
}
