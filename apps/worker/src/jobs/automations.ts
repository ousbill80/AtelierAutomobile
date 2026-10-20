// M17 RG-M17-23/24 — `automations.dispatch` (file « automations », chaque minute + à la
// demande). Pour chaque organisation :
// 1. règles actives × événements `DomainEvent` de leur déclencheur postérieurs à l'activation
//    → un `AutomationRun` unique par (ruleId, eventId) (idempotence), différé de `delayMinutes` ;
// 2. runs dus : conditions réévaluées sur le payload enrichi au moment de l'exécution
//    (`SKIPPED` sinon), mode PROPOSE → suggestion à valider, mode AUTO → actions exécutées.
// Les envois passent par M11 (`Message` QUEUED + file « messages ») avec OptOut, consentement
// et `doNotRemind` revérifiés juste avant ; dédoublonnage par (client, modèle, événement).
//
// Écarts documentés : `create_payment_link`, `schedule_reminder`, `call_webhook` → action
// « non disponible en v1 » (le lien de paiement existant est inséré par `withPaymentLink`) ;
// la proposition PROPOSE est validée depuis /parametres/automatisations (« À valider ») et non
// depuis « Relances du jour » (un `Reminder` exige une `ReminderRule` M10).
import {
  automationMessageKey,
  evaluateConditions,
  guardTrigger,
  interpolateAutomationText,
  nextRetryAt,
  renderTemplate,
  runScheduledFor,
  UNAVAILABLE_ACTIONS,
  UNAVAILABLE_TRIGGERS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
} from "@atelieros/core";
import {
  adminDb,
  automationMessageContext,
  automationRecipientAddress,
  db,
  enrichAutomationContext,
  issuePortalToken,
  previewAutomationActions,
  type AutomationContext,
  type AutomationRule,
  type AutomationRun,
  type GarageLike,
  type Prisma,
} from "@atelieros/db";
import { enqueueMessageSendJob } from "../queues/messages";
import { logger } from "../logger";

type TenantDb = ReturnType<typeof db.forTenant>;

const EVENT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const SUGGESTION_TTL_MS = 48 * 60 * 60 * 1000;
/** Déclencheurs dont les messages sont transactionnels (02 §3 : facture, véhicule prêt, reçu). */
const TRANSACTIONAL_TRIGGERS = new Set<string>([
  "repair_order.status_changed",
  "repair_order.ready",
  "invoice.issued",
  "payment.received",
]);

interface ActionOutcome {
  type: AutomationAction["type"];
  status: "done" | "skipped" | "unavailable";
  detail?: string;
}

class ActionSkipped extends Error {}

async function membersFor(
  tenantDb: TenantDb,
  action: { roles?: string[]; membershipIds?: string[] },
): Promise<string[]> {
  const rows = await tenantDb.membership.findMany({
    where: {
      isActive: true,
      OR: [
        ...(action.roles?.length ? [{ role: { in: action.roles as never[] } }] : []),
        ...(action.membershipIds?.length ? [{ id: { in: action.membershipIds } }] : []),
      ],
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function linkFor(ctx: AutomationContext): string | null {
  if (ctx.repairOrder) return `/ordres/${ctx.repairOrder.id}`;
  if (ctx.invoice) return `/factures/${ctx.invoice.id}`;
  if (ctx.quote) return `/devis/${ctx.quote.id}`;
  if (ctx.customer) return `/clients/${ctx.customer.id}`;
  return null;
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * `withPaymentLink` (RG-M17-23) : lien de paiement actif de la facture ; à défaut, lien portail
 * de la facture ouverte (paiement en ligne M14) ; à défaut, lien de suivi de l'OR (A2,
 * `PortalToken`). Écart : la création d'un nouveau lien de paiement fournisseur
 * (`create_payment_link`) n'est pas livrée en v1.
 */
async function resolvePaymentLink(
  tenantDb: TenantDb,
  ctx: AutomationContext,
  organizationId: string,
): Promise<string | undefined> {
  if (ctx.paymentLinkUrl) return ctx.paymentLinkUrl;
  if (!ctx.customer) return undefined;
  const now = Date.now();
  if (ctx.invoice && ctx.invoice.balance > 0) {
    const { token } = await issuePortalToken(tenantDb, {
      organizationId,
      scope: "INVOICE",
      targetId: ctx.invoice.id,
      customerId: ctx.customer.id,
      expiresAt: new Date(now + 30 * 86_400_000),
    });
    return `${appUrl()}/p/${token}/facture`;
  }
  if (ctx.repairOrder) {
    const { token } = await issuePortalToken(tenantDb, {
      organizationId,
      scope: "REPAIR_ORDER",
      targetId: ctx.repairOrder.id,
      customerId: ctx.customer.id,
      expiresAt: new Date(now + 90 * 86_400_000),
    });
    return `${appUrl()}/p/${token}/suivi`;
  }
  return undefined;
}

async function sendTemplate(
  tenantDb: TenantDb,
  run: AutomationRun,
  rule: AutomationRule,
  action: Extract<AutomationAction, { type: "send_template" }>,
  ctx: AutomationContext,
  garage: GarageLike,
): Promise<string> {
  const customer = ctx.customer;
  if (!customer) throw new ActionSkipped("Aucun client lié à l'événement.");
  const transactional = TRANSACTIONAL_TRIGGERS.has(rule.trigger);
  // Revérification juste avant l'envoi (RG-M17-24, §11).
  if (!transactional && (customer.doNotRemind || !customer.remindersConsent)) {
    throw new ActionSkipped("Client sans consentement aux relances.");
  }
  const address = automationRecipientAddress(customer, action.channel);
  if (!address) throw new ActionSkipped(`Aucune adresse ${action.channel} pour ce client.`);
  if (!transactional) {
    const optOut = await tenantDb.optOut.findFirst({
      where: { address, OR: [{ channel: null }, { channel: action.channel }] },
    });
    if (optOut || customer.optedOutAt) throw new ActionSkipped("Client désinscrit (STOP).");
  }
  const config = await tenantDb.channelConfig.findFirst({
    where: { channel: action.channel, isActive: true },
    orderBy: { priority: "asc" },
  });
  if (!config) throw new ActionSkipped(`Canal ${action.channel} non configuré.`);
  const template = await tenantDb.messageTemplate.findFirst({
    where: { key: action.templateKey, channel: action.channel, isActive: true },
  });
  if (!template) {
    throw new ActionSkipped(`Modèle « ${action.templateKey} » (${action.channel}) introuvable.`);
  }
  const idempotencyKey = automationMessageKey(customer.id, action.templateKey, run.eventId);
  const existing = await tenantDb.message.findFirst({
    where: { idempotencyKey, channel: action.channel },
  });
  if (existing) return existing.id; // deux règles sur le même événement : M11 dédoublonne
  const paymentLink = action.withPaymentLink
    ? await resolvePaymentLink(tenantDb, ctx, run.organizationId)
    : undefined;
  const context = automationMessageContext(ctx, garage, { paymentLink });
  let body: string;
  let subject: string | undefined;
  try {
    body = renderTemplate({ template: template.body, context, channel: action.channel }).body;
    subject = template.subject
      ? renderTemplate({ template: template.subject, context, channel: "EMAIL" }).body
      : undefined;
  } catch (error) {
    // Variable vide (RG-M11-03) : jamais de message à trou, l'action est sautée avec le motif.
    throw new ActionSkipped(error instanceof Error ? error.message : "Rendu du modèle impossible.");
  }
  let messageId: string;
  try {
    const created = await tenantDb.message.create({
      data: {
        organizationId: run.organizationId,
        customerId: customer.id,
        direction: "OUTBOUND",
        channel: action.channel,
        to: address,
        subject,
        body,
        status: "QUEUED",
        provider: config.provider,
        kind: transactional ? "TRANSACTIONAL" : "REMINDER",
        templateKey: action.templateKey,
        idempotencyKey,
      },
    });
    messageId = created.id;
  } catch (error) {
    const unique =
      typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
    if (!unique) throw error;
    const concurrent = await tenantDb.message.findFirst({
      where: { idempotencyKey, channel: action.channel },
    });
    if (!concurrent) throw error;
    return concurrent.id;
  }
  await enqueueMessageSendJob(messageId);
  return messageId;
}

async function executeAction(
  tenantDb: TenantDb,
  run: AutomationRun,
  rule: AutomationRule,
  action: AutomationAction,
  ctx: AutomationContext,
  garage: GarageLike,
): Promise<ActionOutcome> {
  if (UNAVAILABLE_ACTIONS.has(action.type)) {
    return { type: action.type, status: "unavailable", detail: "Action non disponible en v1." };
  }
  try {
    switch (action.type) {
      case "send_template": {
        const messageId = await sendTemplate(tenantDb, run, rule, action, ctx, garage);
        return { type: action.type, status: "done", detail: `message ${messageId}` };
      }
      case "notify_members":
      case "create_task": {
        const messageContext = automationMessageContext(ctx, garage);
        const members = await membersFor(tenantDb, action);
        const dedupeKey = `automation:${run.ruleId}:${run.eventId}`;
        for (const membershipId of members) {
          await tenantDb.notification.upsert({
            where: {
              organizationId_membershipId_dedupeKey: {
                organizationId: run.organizationId,
                membershipId,
                dedupeKey,
              },
            },
            create: {
              organizationId: run.organizationId,
              membershipId,
              type: action.type === "create_task" ? "automation.task" : "automation.notification",
              title: interpolateAutomationText(action.title, messageContext),
              body: action.body ? interpolateAutomationText(action.body, messageContext) : null,
              link: linkFor(ctx),
              severity: "info",
              dedupeKey,
            },
            update: {},
          });
        }
        return { type: action.type, status: "done", detail: `${members.length} membre(s)` };
      }
      case "add_customer_tag": {
        if (!ctx.customer) throw new ActionSkipped("Aucun client lié à l'événement.");
        if (!ctx.customer.tags.includes(action.tag)) {
          await tenantDb.customer.update({
            where: { id: ctx.customer.id },
            data: { tags: { push: action.tag } },
          });
        }
        return { type: action.type, status: "done", detail: action.tag };
      }
      case "assign_conversation": {
        if (!ctx.customer) throw new ActionSkipped("Aucun client lié à l'événement.");
        const conversation = await tenantDb.conversation.findFirst({
          where: { customerId: ctx.customer.id, status: { not: "CLOSED" } },
          orderBy: { lastMessageAt: "desc" },
        });
        if (!conversation) throw new ActionSkipped("Aucune conversation ouverte.");
        await tenantDb.conversation.update({
          where: { id: conversation.id },
          data: { assignedToId: action.membershipId },
        });
        return { type: action.type, status: "done", detail: conversation.id };
      }
      default:
        return { type: action.type, status: "unavailable", detail: "Action non disponible en v1." };
    }
  } catch (error) {
    if (error instanceof ActionSkipped) {
      return { type: action.type, status: "skipped", detail: error.message };
    }
    throw error;
  }
}

async function garageOf(organizationId: string): Promise<GarageLike> {
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, phone: true, address: true, city: true },
  });
  return org;
}

/** Crée les runs des nouveaux événements (idempotent par (ruleId, eventId)). */
async function planRuns(tenantDb: TenantDb, rule: AutomationRule, now: Date): Promise<number> {
  if (UNAVAILABLE_TRIGGERS.has(rule.trigger as AutomationTrigger)) return 0;
  const since = new Date(
    Math.max(rule.activatedAt?.getTime() ?? now.getTime(), now.getTime() - EVENT_LOOKBACK_MS),
  );
  const events = await tenantDb.domainEvent.findMany({
    where: { type: rule.trigger, occurredAt: { gte: since } },
    orderBy: { occurredAt: "asc" },
    take: 500,
  });
  if (!events.length) return 0;
  const existing = new Set(
    (
      await tenantDb.automationRun.findMany({
        where: { ruleId: rule.id, eventId: { in: events.map((e) => e.id) } },
        select: { eventId: true },
      })
    ).map((r) => r.eventId),
  );
  let created = 0;
  for (const event of events) {
    if (existing.has(event.id)) continue;
    const guard = guardTrigger(rule.id, event.payload);
    try {
      await tenantDb.automationRun.create({
        data: {
          organizationId: rule.organizationId,
          ruleId: rule.id,
          eventId: event.id,
          status: guard.allowed ? "PENDING" : "SKIPPED",
          depth: guard.allowed ? guard.depth : 0,
          error: guard.allowed
            ? null
            : guard.reason === "SELF_TRIGGERED"
              ? "Événement produit par cette règle (anti-boucle)."
              : "Profondeur maximale d'automatisations atteinte (anti-boucle).",
          scheduledFor: runScheduledFor(event.occurredAt, rule.delayMinutes, now),
        },
      });
      created += 1;
    } catch (error) {
      const unique =
        typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!unique) throw error;
    }
  }
  return created;
}

function jsonResult(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Exécute (ou propose) un run dû. Exporté pour les tests. */
export async function executeRun(
  tenantDb: TenantDb,
  run: AutomationRun & { rule: AutomationRule },
  now: Date,
): Promise<void> {
  const rule = run.rule;
  const finish = (status: string, data: { result?: unknown; error?: string | null }) =>
    tenantDb.automationRun.update({
      where: { id: run.id },
      data: {
        status,
        executedAt: now,
        ...(data.result !== undefined ? { result: jsonResult(data.result) } : {}),
        ...(data.error !== undefined ? { error: data.error } : {}),
      },
    });
  if (!rule.isActive) {
    await finish("SKIPPED", { error: "Règle désactivée avant l'exécution." });
    return;
  }
  const event = await tenantDb.domainEvent.findFirst({ where: { id: run.eventId } });
  if (!event) {
    await finish("FAILED", { error: "Événement introuvable." });
    return;
  }
  const ctx = await enrichAutomationContext(
    tenantDb,
    (event.payload ?? {}) as Record<string, unknown>,
    now,
  );
  if (rule.siteIds.length && ctx.site && !rule.siteIds.includes(ctx.site.id)) {
    await finish("SKIPPED", { error: "Site hors du périmètre de la règle." });
    return;
  }
  const conditions = evaluateConditions(
    (rule.conditions ?? []) as unknown as AutomationCondition[],
    ctx,
  );
  if (!conditions.matched) {
    await finish("SKIPPED", {
      result: { failed: conditions.failed },
      error: "Conditions non remplies.",
    });
    return;
  }
  const actions = (rule.actions ?? []) as unknown as AutomationAction[];
  const garage = await garageOf(run.organizationId);
  const previous = (run.result ?? {}) as { suggestionId?: string; approvedAt?: string };

  if (rule.mode === "PROPOSE" && !previous.approvedAt) {
    if (previous.suggestionId) {
      const suggestion = await tenantDb.aiSuggestion.findFirst({
        where: { id: previous.suggestionId },
      });
      if (!suggestion || suggestion.status === "DISMISSED") {
        await finish("SKIPPED", { error: "Proposition refusée." });
      } else if (suggestion.status === "EXPIRED" || suggestion.expiresAt <= now) {
        await finish("SKIPPED", { error: "Proposition expirée sans validation." });
      }
      return;
    }
    const previews = await previewAutomationActions(tenantDb, actions, ctx, garage);
    const suggestion = await tenantDb.aiSuggestion.create({
      data: {
        organizationId: run.organizationId,
        feature: "automation",
        targetEntity: "automation_run",
        targetId: run.id,
        isFallback: true, // proposition sans IA
        payload: jsonResult({
          ruleId: rule.id,
          ruleName: rule.name,
          runId: run.id,
          actions: previews,
        }),
        expiresAt: new Date(now.getTime() + SUGGESTION_TTL_MS),
      },
    });
    await tenantDb.automationRun.update({
      where: { id: run.id },
      data: { result: jsonResult({ awaitingApproval: true, suggestionId: suggestion.id }) },
    });
    return;
  }

  try {
    const outcomes: ActionOutcome[] = [];
    for (const action of actions) {
      outcomes.push(await executeAction(tenantDb, run, rule, action, ctx, garage));
    }
    const allSkipped = outcomes.every((o) => o.status !== "done");
    await finish(allSkipped ? "SKIPPED" : "SUCCEEDED", {
      result: { ...previous, actions: outcomes },
      error: allSkipped
        ? (outcomes.find((o) => o.detail)?.detail ?? "Aucune action effectuée.")
        : null,
    });
    await tenantDb.domainEvent.create({
      data: {
        organizationId: run.organizationId,
        type: "automation.executed",
        payload: jsonResult({
          ruleId: rule.id,
          runId: run.id,
          eventId: run.eventId,
          status: allSkipped ? "SKIPPED" : "SUCCEEDED",
          customerId: ctx.customer?.id ?? null,
          automation: { ruleId: rule.id, depth: run.depth + 1 },
        }),
      },
    });
  } catch (error) {
    const attempts = run.attempts + 1;
    const retryAt = nextRetryAt(attempts, now);
    const message = error instanceof Error ? error.message.slice(0, 500) : "Erreur inconnue.";
    await tenantDb.automationRun.update({
      where: { id: run.id },
      data: retryAt
        ? { attempts, error: message, scheduledFor: retryAt }
        : { attempts, error: message, status: "FAILED", executedAt: now },
    });
  }
}

export async function dispatchAutomationsForOrganization(
  organizationId: string,
  now: Date,
): Promise<{ planned: number; processed: number }> {
  const tenantDb = db.forTenant({ organizationId });
  const rules = await tenantDb.automationRule.findMany({ where: { isActive: true } });
  let planned = 0;
  for (const rule of rules) planned += await planRuns(tenantDb, rule, now);
  const due = await tenantDb.automationRun.findMany({
    where: { status: "PENDING", scheduledFor: { lte: now } },
    include: { rule: true },
    orderBy: { scheduledFor: "asc" },
    take: 200,
  });
  for (const run of due) await executeRun(tenantDb, run, now);
  return { planned, processed: due.length };
}

export async function processAutomationsDispatchJob(now: Date = new Date()): Promise<void> {
  const [ruleOrgs, runOrgs] = await Promise.all([
    adminDb.automationRule.findMany({
      where: { isActive: true },
      distinct: ["organizationId"],
      select: { organizationId: true },
    }),
    adminDb.automationRun.findMany({
      where: { status: "PENDING", scheduledFor: { lte: now } },
      distinct: ["organizationId"],
      select: { organizationId: true },
    }),
  ]);
  const ids = new Set([...ruleOrgs, ...runOrgs].map((r) => r.organizationId));
  for (const organizationId of ids) {
    try {
      await dispatchAutomationsForOrganization(organizationId, now);
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : error },
        "automations.dispatch : échec pour une organisation",
      );
    }
  }
}
