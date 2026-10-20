import { z } from "zod";

// M17 RG-M17-23 — règles d'automatisation « si… alors… » (entrées du routeur `automations`).
// Les listes reprennent `@atelieros/core` (catalogue) ; dupliquées ici en littéraux pour garder
// `validators` sans dépendance d'exécution vers `core`.

export const automationTriggerSchema = z.enum([
  "repair_order.status_changed",
  "repair_order.ready",
  "quote.viewed",
  "invoice.issued",
  "payment.received",
  "appointment.no_show",
  "customer.created",
  "portal.feedback_received",
]);

export const automationConditionSchema = z.object({
  field: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)*$/, "Champ invalide."),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"]),
  value: z.union([
    z.string().max(200),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string().max(200), z.number()])).max(50),
  ]),
});

const roleSchema = z.enum([
  "OWNER",
  "MANAGER",
  "ADVISOR",
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ACCOUNTANT",
]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("send_template"),
    templateKey: z.string().trim().min(1).max(100),
    channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
    withPaymentLink: z.boolean().optional(),
  }),
  z.object({ type: z.literal("create_payment_link") }),
  z.object({
    type: z.literal("notify_members"),
    roles: z.array(roleSchema).max(7).optional(),
    membershipIds: z.array(z.string()).max(50).optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).optional(),
  }),
  z.object({ type: z.literal("assign_conversation"), membershipId: z.string().min(1) }),
  z.object({ type: z.literal("add_customer_tag"), tag: z.string().trim().min(1).max(50) }),
  z.object({
    type: z.literal("create_task"),
    roles: z.array(roleSchema).max(7).optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("schedule_reminder"),
    days: z.number().int().min(0).max(365),
    templateKey: z.string().trim().min(1).max(100),
  }),
  z.object({ type: z.literal("call_webhook"), endpointId: z.string().min(1) }),
]);

export const automationRuleInputSchema = z.object({
  name: z.string().trim().min(1, "Donnez un nom à la règle.").max(120),
  trigger: automationTriggerSchema,
  conditions: z.array(automationConditionSchema).max(10).default([]),
  actions: z.array(automationActionSchema).min(1, "Ajoutez au moins une action.").max(5),
  mode: z.enum(["AUTO", "PROPOSE"]).default("PROPOSE"),
  delayMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .default(0),
  siteIds: z.array(z.string()).max(50).default([]),
});
export type AutomationRuleInput = z.infer<typeof automationRuleInputSchema>;

export const automationRuleUpdateSchema = automationRuleInputSchema.extend({ id: z.string() });

export const automationTestInputSchema = z.object({
  ruleId: z.string(),
  sampleEntity: z.object({
    type: z.enum(["repair_order", "invoice", "quote", "customer", "payment", "appointment"]),
    id: z.string().min(1),
  }),
});
