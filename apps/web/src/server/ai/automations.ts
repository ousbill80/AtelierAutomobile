// M17 RG-M17-23 — acceptation d'une proposition d'automatisation (mode PROPOSE) : le run est
// marqué approuvé puis exécuté par `automations.dispatch` (apps/worker), qui revérifie
// conditions, OptOut et consentement juste avant l'envoi. Permission de la procédure métier
// concernée : `message:send` (les envois passent par M11).
import { db, type Prisma } from "@atelieros/db";
import { TRPCError } from "@trpc/server";
import { writeAuditLog } from "../audit";
import { requestAutomationDispatch } from "../automations/queue";
import { registerAcceptHandler } from "./accept";

registerAcceptHandler("automation", {
  permissions: ["message:send"],
  async run({ ctx, suggestion, now }) {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const run = suggestion.targetId
      ? await tx.automationRun.findFirst({ where: { id: suggestion.targetId } })
      : null;
    if (!run || run.status !== "PENDING") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Cette exécution n'est plus en attente de validation.",
      });
    }
    const previous = (run.result ?? {}) as Record<string, unknown>;
    await tx.automationRun.update({
      where: { id: run.id },
      data: {
        result: {
          ...previous,
          approvedAt: now.toISOString(),
          approvedById: ctx.membership.id,
        } as Prisma.InputJsonValue,
        scheduledFor: now,
      },
    });
    await writeAuditLog({
      organizationId: ctx.organizationId,
      userId: ctx.user.id,
      membershipId: ctx.membership.id,
      action: "automation.run_approved",
      entity: "AutomationRun",
      entityId: run.id,
      after: { ruleId: run.ruleId, eventId: run.eventId, aiSuggestionId: suggestion.id },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await requestAutomationDispatch();
    return { result: { runId: run.id, approved: true } };
  },
});
