// §8 — routeur `reminderRules` (paramétrage des règles de relance, RG-M10-02/03/04).
import { addDays, pickStep, type PickStepRuleStep } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  reminderRuleGetInputSchema,
  reminderRuleSimulateInputSchema,
  reminderRuleToggleInputSchema,
  reminderRuleUpsertInputSchema,
} from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;

/**
 * Simplification documentée : seuls INSPECTION/SERVICE/RECEIVABLE (types exercés par les
 * données de démonstration) ont une recherche de candidats dédiée ici. Les autres types
 * renvoient une simulation vide plutôt que de dupliquer l'intégralité des requêtes de
 * `apps/worker/src/jobs/remindersPlan.ts` (non réutilisables depuis `apps/web` : chaque app
 * orchestre elle-même, 01-architecture-technique.md).
 */
async function simulateCandidates(
  tenantDb: TenantDb,
  type: string,
  today: Date,
): Promise<{ entityId: string; anchor: Date }[]> {
  if (type === "INSPECTION") {
    const vehicles = await tenantDb.vehicle.findMany({
      where: {
        deletedAt: null,
        inspectionExpiryDate: { gte: addDays(today, -60), lte: addDays(today, 45) },
      },
      select: { id: true, inspectionExpiryDate: true },
    });
    return vehicles
      .filter((v) => v.inspectionExpiryDate)
      .map((v) => ({ entityId: v.id, anchor: v.inspectionExpiryDate! }));
  }
  if (type === "SERVICE") {
    const vehicles = await tenantDb.vehicle.findMany({
      where: {
        deletedAt: null,
        nextServiceDueDate: { gte: addDays(today, -90), lte: addDays(today, 30) },
      },
      select: { id: true, nextServiceDueDate: true },
    });
    return vehicles
      .filter((v) => v.nextServiceDueDate)
      .map((v) => ({ entityId: v.id, anchor: v.nextServiceDueDate! }));
  }
  if (type === "RECEIVABLE") {
    const cases = await tenantDb.collectionCase.findMany({
      where: { status: { in: ["OPEN", "ESCALATED"] } },
      select: { id: true, oldestDueDate: true },
    });
    return cases
      .filter((c) => c.oldestDueDate)
      .map((c) => ({ entityId: c.id, anchor: c.oldestDueDate! }));
  }
  return [];
}

export const reminderRulesRouter = router({
  list: requirePermission("reminder:read").query(({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    return tenantDb.reminderRule.findMany({ orderBy: { name: "asc" } });
  }),

  get: requirePermission("reminder:read")
    .input(reminderRuleGetInputSchema)
    .query(({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.reminderRule.findFirstOrThrow({ where: { id: input.id } });
    }),

  upsert: requirePermission("reminder:rules_manage")
    .input(reminderRuleUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const data = {
        organizationId: ctx.organizationId,
        type: input.type,
        name: input.name,
        isActive: input.isActive,
        steps: input.steps,
        sendWindow: input.sendWindow,
        conditions: input.conditions,
        stopOn: input.stopOn,
      };
      if (input.id) {
        return tenantDb.reminderRule.update({ where: { id: input.id }, data });
      }
      return tenantDb.reminderRule.create({ data });
    }),

  toggle: requirePermission("reminder:rules_manage")
    .input(reminderRuleToggleInputSchema)
    .mutation(({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      return tenantDb.reminderRule.update({
        where: { id: input.id },
        data: { isActive: input.isActive },
      });
    }),

  simulate: requirePermission("reminder:rules_manage")
    .input(reminderRuleSimulateInputSchema)
    .query(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const today = new Date();
      const candidates = await simulateCandidates(tenantDb, input.rule.type, today);

      const ruleSteps: PickStepRuleStep[] = input.rule.steps.map((s) => ({
        key: s.key,
        offsetDays: s.offsetDays,
        catchUpDays: s.catchUpDays,
      }));

      const byStep: Record<string, number> = {};
      const sample: { entityId: string; stepKey: string }[] = [];
      let noChannel = 0;

      for (const candidate of candidates) {
        const pick = pickStep({
          steps: ruleSteps,
          anchor: candidate.anchor,
          today,
          history: [],
          minGapDays: 3,
          defaultCatchUpDays: 7,
        });
        if (!pick) continue;
        byStep[pick.step.key] = (byStep[pick.step.key] ?? 0) + 1;
        const step = input.rule.steps.find((s) => s.key === pick.step.key);
        if (step && step.channels.length === 0 && !step.internalOnly) noChannel += 1;
        if (sample.length < 10)
          sample.push({ entityId: candidate.entityId, stepKey: pick.step.key });
      }

      const total = Object.values(byStep).reduce((sum, n) => sum + n, 0);
      return { total, byStep, grouped: 0, noChannel, sample };
    }),
});
