// M09 §9 — jobs de nuit `receivables.age` (01:00) et `collections.promises` (01:15).
// Chaque organisation est traitée isolément (une erreur n'arrête pas les autres) ;
// toutes les décisions viennent de `@atelieros/core` via `@atelieros/db/receivables`.
import {
  buildPromiseBrokenDedupeKey,
  businessDate,
  systemClock,
  type Clock,
} from "@atelieros/core";
import {
  adminDb,
  collectionSettingsFrom,
  db,
  evaluateCasePromises,
  syncCustomerReceivables,
} from "@atelieros/db";
import { logger } from "../logger";

const PROMISE_BROKEN_APPROVAL_ABOVE = 500_000;

async function forEachOrganization(
  jobName: string,
  fn: (org: { id: string; timezone: string; settings: unknown }) => Promise<void>,
): Promise<void> {
  const organizations = await adminDb.organization.findMany({
    select: { id: true, timezone: true, settings: true },
  });
  for (const org of organizations) {
    try {
      await fn(org);
    } catch (error) {
      logger.error(
        { organizationId: org.id, error: error instanceof Error ? error.message : error },
        `${jobName} : échec sur une organisation, passage à la suivante`,
      );
    }
  }
}

/**
 * Passe les factures en `OVERDUE`, ouvre / met à jour / ferme / rouvre les dossiers,
 * reprend les pauses échues et recalcule `riskScore`. Idempotent.
 */
export async function processReceivablesAgeJob(clock: Clock = systemClock): Promise<void> {
  await forEachOrganization("receivables.age", async (org) => {
    const now = clock.now();
    const today = businessDate(now, org.timezone);
    const settings = collectionSettingsFrom(org.settings);
    const tenantDb = db.forTenant({ organizationId: org.id });
    const [withInvoices, withCases] = await Promise.all([
      tenantDb.invoice.findMany({
        where: {
          billTo: "CUSTOMER",
          status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] },
          balance: { gt: 0 },
        },
        select: { customerId: true },
        distinct: ["customerId"],
      }),
      tenantDb.collectionCase.findMany({
        where: { status: { in: ["OPEN", "PROMISED", "PAUSED", "DISPUTED", "ESCALATED"] } },
        select: { customerId: true },
      }),
    ]);
    const customerIds = new Set([...withInvoices, ...withCases].map((r) => r.customerId));
    for (const customerId of customerIds) {
      await tenantDb.transaction((tx) =>
        syncCustomerReceivables(tx, { organizationId: org.id, customerId, today, now, settings }),
      );
    }
  });
}

/**
 * RG-M09-06 : évalue les promesses échues ; une promesse rompue planifie une relance
 * `PROMISE_BROKEN` unique (dedupeKey) le jour même à 10:00, en validation si client
 * entreprise ou montant > 500 000 FCFA.
 */
export async function processCollectionsPromisesJob(clock: Clock = systemClock): Promise<void> {
  await forEachOrganization("collections.promises", async (org) => {
    const now = clock.now();
    const today = businessDate(now, org.timezone);
    const settings = collectionSettingsFrom(org.settings);
    const tenantDb = db.forTenant({ organizationId: org.id });
    const cases = await tenantDb.collectionCase.findMany({
      where: { promises: { some: { status: "PENDING" } } },
      select: { id: true },
    });
    const rule = await tenantDb.reminderRule.findFirst({
      where: { type: "RECEIVABLE", isActive: true },
    });
    for (const { id: caseId } of cases) {
      await tenantDb.transaction(async (tx) => {
        const changed = await evaluateCasePromises(tx, {
          organizationId: org.id,
          caseId,
          today,
          now,
          graceDays: settings.graceDays,
        });
        const broken = changed.filter(
          (c) => c.status === "BROKEN" || c.status === "PARTIALLY_KEPT",
        );
        if (broken.length === 0 || !rule) return;
        const kase = await tx.collectionCase.findFirst({
          where: { id: caseId },
          include: { customer: { select: { type: true } } },
        });
        if (!kase) return;
        const anchor = kase.anchorDate ?? kase.oldestDueDate ?? today;
        const needsApproval =
          kase.customer.type === "COMPANY" ||
          kase.overdueDue > PROMISE_BROKEN_APPROVAL_ABOVE ||
          kase.brokenPromiseCount >= 2;
        for (const promise of broken) {
          const dedupeKey = buildPromiseBrokenDedupeKey(kase.id, anchor, promise.id);
          const exists = await tx.reminder.findFirst({ where: { dedupeKey } });
          if (exists) continue;
          await tx.reminder.create({
            data: {
              organizationId: org.id,
              ruleId: rule.id,
              type: "RECEIVABLE",
              stepKey: "PROMISE_BROKEN",
              customerId: kase.customerId,
              dueDate: anchor,
              scheduledFor: new Date(`${today.toISOString().slice(0, 10)}T10:00:00.000Z`),
              status: needsApproval ? "NEEDS_APPROVAL" : "PLANNED",
              priority: 1,
              dedupeKey,
            },
          });
        }
      });
    }
  });
}
