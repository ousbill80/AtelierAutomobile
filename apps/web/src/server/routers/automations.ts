// M17 §8 — routeur `automations` : règles « si… alors… » (RG-M17-23), modèles fournis activables
// en un clic (RG-M17-25), test à blanc sur une entité existante (aucun envoi), historique des
// exécutions et propositions à valider (mode PROPOSE). L'exécution est dans apps/worker
// (`automations.dispatch`). Permissions : `ai:configure` + `reminder:rules_manage` (M17 §10).
import {
  AUTOMATION_TEMPLATES,
  automationTemplateByKey,
  conflictingSendRules,
  evaluateConditions,
  UNAVAILABLE_TRIGGERS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
} from "@atelieros/core";
import {
  adminDb,
  db,
  enrichAutomationContext,
  previewAutomationActions,
  type Prisma,
} from "@atelieros/db";
import {
  automationRuleInputSchema,
  automationRuleUpdateSchema,
  automationTestInputSchema,
  type AutomationRuleInput,
} from "@atelieros/validators";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requestAutomationDispatch } from "../automations/queue";
import { requirePermission, router } from "../trpc";

type TenantDb = ReturnType<typeof db.forTenant>;

const manage = requirePermission("ai:configure", "reminder:rules_manage");

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Règle d'automatisation introuvable." });
}

function assertActivable(trigger: string): void {
  if (UNAVAILABLE_TRIGGERS.has(trigger as AutomationTrigger)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Ce déclencheur n'est pas encore disponible : la règle est enregistrée mais ne peut pas être activée.",
    });
  }
}

async function warningsFor(
  tx: TenantDb,
  candidate: { id?: string; trigger: string; actions: readonly { type: string }[] },
): Promise<string[]> {
  const rules = await tx.automationRule.findMany({ where: { isActive: true } });
  return conflictingSendRules(
    rules.map((r) => ({ ...r, actions: r.actions as unknown as { type: string }[] })),
    candidate,
  ).map((r) => r.name);
}

function ruleData(input: AutomationRuleInput) {
  return {
    name: input.name,
    trigger: input.trigger,
    conditions: json(input.conditions),
    actions: json(input.actions),
    mode: input.mode,
    delayMinutes: input.delayMinutes,
    siteIds: input.siteIds,
  };
}

/** Payload d'événement simulé à partir d'une entité existante (test à blanc). */
async function samplePayload(
  tx: TenantDb,
  entity: { type: string; id: string },
): Promise<Record<string, unknown>> {
  switch (entity.type) {
    case "repair_order": {
      const ro = await tx.repairOrder.findFirst({ where: { id: entity.id } });
      if (!ro) break;
      return {
        repairOrderId: ro.id,
        customerId: ro.customerId,
        vehicleId: ro.vehicleId,
        to: ro.status,
        newStatus: ro.status,
      };
    }
    case "invoice": {
      const invoice = await tx.invoice.findFirst({ where: { id: entity.id } });
      if (!invoice) break;
      return {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        repairOrderId: invoice.repairOrderId,
      };
    }
    case "quote": {
      const quote = await tx.quote.findFirst({ where: { id: entity.id } });
      if (!quote) break;
      return { quoteId: quote.id, customerId: quote.customerId };
    }
    case "payment": {
      const payment = await tx.payment.findFirst({ where: { id: entity.id } });
      if (!payment) break;
      return { paymentId: payment.id, customerId: payment.customerId, amount: payment.amount };
    }
    case "appointment": {
      const appointment = await tx.appointment.findFirst({ where: { id: entity.id } });
      if (!appointment) break;
      return {
        appointmentId: appointment.id,
        customerId: appointment.customerId,
        vehicleId: appointment.vehicleId,
      };
    }
    case "customer": {
      const customer = await tx.customer.findFirst({ where: { id: entity.id } });
      if (!customer) break;
      return { customerId: customer.id, type: customer.type };
    }
  }
  throw new TRPCError({ code: "NOT_FOUND", message: "Élément d'exemple introuvable." });
}

async function audit(
  ctx: {
    organizationId: string;
    user: { id: string };
    membership: { id: string };
    ip: string | null;
    userAgent: string | null;
  },
  action: string,
  ruleId: string,
  before: unknown,
  after: unknown,
) {
  await writeAuditLog({
    organizationId: ctx.organizationId,
    userId: ctx.user.id,
    membershipId: ctx.membership.id,
    action,
    entity: "AutomationRule",
    entityId: ruleId,
    before: before ?? undefined,
    after: after ?? undefined,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

export const automationsRouter = router({
  /** Modèles fournis (RG-M17-25) et état d'activation dans l'organisation. */
  templates: manage.query(async ({ ctx }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const rules = await tx.automationRule.findMany({
      where: { templateKey: { not: null } },
      select: { id: true, templateKey: true, isActive: true },
    });
    return AUTOMATION_TEMPLATES.map((t) => {
      const rule = rules.find((r) => r.templateKey === t.key);
      return {
        key: t.key,
        name: t.name,
        trigger: t.trigger,
        mode: t.mode,
        delayMinutes: t.delayMinutes,
        actionTypes: t.actions.map((a) => a.type),
        available: !UNAVAILABLE_TRIGGERS.has(t.trigger),
        ruleId: rule?.id ?? null,
        isActive: rule?.isActive ?? false,
      };
    });
  }),

  list: manage.query(async ({ ctx }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const rules = await tx.automationRule.findMany({ orderBy: { createdAt: "asc" } });
    const lastRuns = await Promise.all(
      rules.map((r) =>
        tx.automationRun.findFirst({
          where: { ruleId: r.id, status: { not: "PENDING" } },
          orderBy: { executedAt: "desc" },
          select: { status: true, executedAt: true },
        }),
      ),
    );
    return rules.map((rule, i) => ({
      id: rule.id,
      name: rule.name,
      trigger: rule.trigger,
      mode: rule.mode,
      isActive: rule.isActive,
      delayMinutes: rule.delayMinutes,
      templateKey: rule.templateKey,
      actionTypes: (rule.actions as unknown as AutomationAction[]).map((a) => a.type),
      available: !UNAVAILABLE_TRIGGERS.has(rule.trigger as AutomationTrigger),
      lastRun: lastRuns[i] ?? null,
    }));
  }),

  get: manage.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const rule = await tx.automationRule.findFirst({ where: { id: input.id } });
    if (!rule) notFound();
    return {
      ...rule,
      conditions: rule.conditions as unknown as AutomationCondition[],
      actions: rule.actions as unknown as AutomationAction[],
    };
  }),

  create: manage.input(automationRuleInputSchema).mutation(async ({ ctx, input }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const rule = await tx.automationRule.create({
      data: {
        organizationId: ctx.organizationId,
        ...ruleData(input),
        isActive: false,
        createdById: ctx.membership.id,
      },
    });
    await audit(ctx, "automation.created", rule.id, null, rule);
    return { rule, warnings: await warningsFor(tx, { ...input, id: rule.id }) };
  }),

  update: manage.input(automationRuleUpdateSchema).mutation(async ({ ctx, input }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const before = await tx.automationRule.findFirst({ where: { id: input.id } });
    if (!before) notFound();
    if (before.isActive) assertActivable(input.trigger);
    const rule = await tx.automationRule.update({
      where: { id: input.id },
      data: ruleData(input),
    });
    await audit(ctx, "automation.updated", rule.id, before, rule);
    return { rule, warnings: await warningsFor(tx, input) };
  }),

  toggle: manage
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const before = await tx.automationRule.findFirst({ where: { id: input.id } });
      if (!before) notFound();
      if (input.isActive) assertActivable(before.trigger);
      const rule = await tx.automationRule.update({
        where: { id: input.id },
        data: {
          isActive: input.isActive,
          // Seuls les événements postérieurs à l'activation déclenchent la règle.
          ...(input.isActive && !before.isActive ? { activatedAt: new Date() } : {}),
        },
      });
      await audit(
        ctx,
        input.isActive ? "automation.activated" : "automation.deactivated",
        rule.id,
        { isActive: before.isActive },
        { isActive: rule.isActive },
      );
      const warnings = input.isActive
        ? await warningsFor(tx, {
            id: rule.id,
            trigger: rule.trigger,
            actions: rule.actions as unknown as { type: string }[],
          })
        : [];
      return { rule, warnings };
    }),

  delete: manage.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const before = await tx.automationRule.findFirst({ where: { id: input.id } });
    if (!before) notFound();
    await tx.automationRun.deleteMany({ where: { ruleId: input.id } });
    await tx.automationRule.delete({ where: { id: input.id } });
    await audit(ctx, "automation.deleted", input.id, before, null);
    return { ok: true };
  }),

  /** Active un modèle fourni : crée la règle (et les modèles de messages manquants). */
  activateTemplate: manage.input(z.object({ key: z.string() })).mutation(async ({ ctx, input }) => {
    const template = automationTemplateByKey(input.key);
    if (!template) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Modèle d'automatisation introuvable." });
    }
    assertActivable(template.trigger);
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    for (const mt of template.messageTemplates ?? []) {
      const exists = await tx.messageTemplate.findFirst({
        where: { key: mt.key, channel: mt.channel },
      });
      if (!exists) {
        await tx.messageTemplate.create({
          data: {
            organizationId: ctx.organizationId,
            key: mt.key,
            name: mt.name,
            channel: mt.channel,
            body: mt.body,
            isActive: true,
            isTransactional: true,
          },
        });
      }
    }
    const now = new Date();
    const existing = await tx.automationRule.findFirst({ where: { templateKey: template.key } });
    const rule = existing
      ? await tx.automationRule.update({
          where: { id: existing.id },
          data: { isActive: true, ...(existing.isActive ? {} : { activatedAt: now }) },
        })
      : await tx.automationRule.create({
          data: {
            organizationId: ctx.organizationId,
            name: template.name,
            trigger: template.trigger,
            conditions: json(template.conditions),
            actions: json(template.actions),
            mode: template.mode,
            delayMinutes: template.delayMinutes,
            siteIds: [],
            isActive: true,
            activatedAt: now,
            templateKey: template.key,
            createdById: ctx.membership.id,
          },
        });
    await audit(ctx, "automation.activated", rule.id, existing ?? null, rule);
    return {
      rule,
      warnings: await warningsFor(tx, { id: rule.id, ...template }),
    };
  }),

  /** Test à blanc : conditions et aperçu des actions sur un élément existant, sans envoi. */
  test: manage.input(automationTestInputSchema).query(async ({ ctx, input }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const rule = await tx.automationRule.findFirst({ where: { id: input.ruleId } });
    if (!rule) notFound();
    const payload = await samplePayload(tx, input.sampleEntity);
    const context = await enrichAutomationContext(tx, payload);
    const conditions = evaluateConditions(
      rule.conditions as unknown as AutomationCondition[],
      context,
    );
    const garage = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { name: true, phone: true, address: true, city: true },
    });
    const actions = await previewAutomationActions(
      tx,
      rule.actions as unknown as AutomationAction[],
      context,
      garage,
    );
    const siteExcluded =
      rule.siteIds.length > 0 && !!context.site && !rule.siteIds.includes(context.site.id);
    return {
      matched: conditions.matched && !siteExcluded,
      failed: conditions.failed,
      siteExcluded,
      actions,
    };
  }),

  /** Historique des exécutions (le plus récent d'abord). */
  runs: manage
    .input(z.object({ ruleId: z.string().optional(), cursor: z.string().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const rows = await tx.automationRun.findMany({
        where: input.ruleId ? { ruleId: input.ruleId } : {},
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 51,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        include: { rule: { select: { name: true } } },
      });
      const items = rows.slice(0, 50).map((r) => ({
        id: r.id,
        ruleId: r.ruleId,
        ruleName: r.rule.name,
        eventId: r.eventId,
        status: r.status,
        awaitingApproval:
          r.status === "PENDING" &&
          !!(r.result as { awaitingApproval?: boolean; approvedAt?: string } | null)
            ?.awaitingApproval &&
          !(r.result as { approvedAt?: string } | null)?.approvedAt,
        result: r.result,
        error: r.error,
        attempts: r.attempts,
        scheduledFor: r.scheduledFor,
        executedAt: r.executedAt,
        createdAt: r.createdAt,
      }));
      return { items, nextCursor: rows.length > 50 ? rows[49]!.id : null };
    }),

  /** Propositions (mode PROPOSE) en attente de validation. */
  pendingApprovals: manage.query(async ({ ctx }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    return tx.aiSuggestion.findMany({
      where: {
        feature: "automation",
        targetEntity: "automation_run",
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }),

  /** Éléments récents proposés pour le test à blanc (« choisir un OR / une facture »). */
  sampleEntities: manage
    .input(z.object({ type: automationTestInputSchema.shape.sampleEntity.shape.type }))
    .query(async ({ ctx, input }) => {
      const tx = db.forTenant({ organizationId: ctx.organizationId });
      const take = 20;
      const order = { createdAt: "desc" as const };
      switch (input.type) {
        case "repair_order":
          return (
            await tx.repairOrder.findMany({ orderBy: order, take, include: { customer: true } })
          ).map((r) => ({ id: r.id, label: `${r.number} — ${r.customer.displayName}` }));
        case "invoice":
          return (
            await tx.invoice.findMany({
              where: { number: { not: null } },
              orderBy: order,
              take,
              include: { customer: true },
            })
          ).map((r) => ({ id: r.id, label: `${r.number} — ${r.customer?.displayName ?? ""}` }));
        case "quote":
          return (
            await tx.quote.findMany({ orderBy: order, take, include: { customer: true } })
          ).map((r) => ({ id: r.id, label: `${r.number} — ${r.customer.displayName}` }));
        case "customer":
          return (
            await tx.customer.findMany({ where: { deletedAt: null }, orderBy: order, take })
          ).map((r) => ({ id: r.id, label: r.displayName }));
        case "payment":
          return (await tx.payment.findMany({ orderBy: order, take })).map((r) => ({
            id: r.id,
            label: `${r.number} — ${r.amount} FCFA`,
          }));
        case "appointment":
          return (
            await tx.appointment.findMany({ orderBy: order, take, include: { customer: true } })
          ).map((r) => ({
            id: r.id,
            label: `${r.startsAt.toISOString().slice(0, 16).replace("T", " ")} — ${r.customer.displayName}`,
          }));
      }
    }),

  /** Modèles de messages M11 actifs (éditeur, action « Envoyer un modèle »). */
  messageTemplates: manage.query(async ({ ctx }) => {
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    return tx.messageTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }, { channel: "asc" }],
      select: { key: true, name: true, channel: true },
    });
  }),

  /** Lance un passage immédiat du moteur (après une modification, pour ne pas attendre). */
  dispatchNow: manage.mutation(async () => {
    await requestAutomationDispatch();
    return { ok: true };
  }),
});
