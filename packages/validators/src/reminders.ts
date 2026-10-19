import { z } from "zod";

export const reminderTypeSchema = z.enum([
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
]);

export const reminderChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);

export const reminderStepAnchorSchema = z.enum(["default", "sentAt", "validUntil"]);
export const reminderAttachmentSchema = z.enum(["statement", "formal_notice", "invoice"]);

/** RG-M10-03 — un palier de `ReminderRule.steps[]` (cf. `packages/core/src/reminders/steps.ts`). */
export const reminderStepInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Z0-9+\-_]{1,16}$/, "La clé de palier doit être en MAJUSCULES (A-Z, 0-9, +, -, _)."),
  label: z.string().trim().min(1).max(60),
  offsetDays: z.number().int().min(-365).max(365),
  offsetHours: z.number().int().optional(),
  anchor: reminderStepAnchorSchema.optional(),
  templateKey: z.string().trim().min(1),
  autoSend: z.boolean(),
  channels: z.array(reminderChannelSchema),
  internalOnly: z.boolean().optional(),
  requiresPermission: z.string().trim().min(1).optional(),
  attachments: z.array(reminderAttachmentSchema).optional(),
  catchUpDays: z.number().int().min(0).optional(),
  sendAt: z
    .string()
    .regex(/^\d\d:\d\d$/)
    .optional(),
});
export type ReminderStepInput = z.infer<typeof reminderStepInputSchema>;

/** RG-M10-09 — fenêtre d'envoi d'une règle (0 = dimanche, cf. `core/calendar`). */
export const sendWindowInputSchema = z.object({
  days: z.array(
    z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
  ),
  from: z.string().regex(/^\d\d:\d\d$/),
  to: z.string().regex(/^\d\d:\d\d$/),
  preferredTime: z.string().regex(/^\d\d:\d\d$/),
});
export type SendWindowInput = z.infer<typeof sendWindowInputSchema>;

/** Conditions d'éligibilité d'une règle (RG-M10-04), persistées en `ReminderRule.conditions`. */
export const reminderRuleConditionsInputSchema = z.object({
  customerTypes: z.array(z.enum(["INDIVIDUAL", "COMPANY"])).optional(),
  minAmount: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
  siteIds: z.array(z.string()).optional(),
  vehicleMinYear: z.number().int().optional(),
});
export type ReminderRuleConditionsInput = z.infer<typeof reminderRuleConditionsInputSchema>;

export const upsertReminderRuleInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  type: reminderTypeSchema,
  name: z.string().trim().min(1).max(80),
  isActive: z.boolean().default(true),
  steps: z.array(reminderStepInputSchema).min(1).max(8),
  sendWindow: sendWindowInputSchema,
  conditions: reminderRuleConditionsInputSchema.default({}),
  stopOn: z.array(z.string()).default([]),
  minGapDays: z.number().int().min(0).optional(),
  catchUpDays: z.number().int().min(0).optional(),
});
export type UpsertReminderRuleInput = z.infer<typeof upsertReminderRuleInputSchema>;

export const getReminderRuleInputSchema = z.object({ id: z.string().trim().min(1) });
export type GetReminderRuleInput = z.infer<typeof getReminderRuleInputSchema>;

export const toggleReminderRuleInputSchema = z.object({
  id: z.string().trim().min(1),
  isActive: z.boolean(),
});
export type ToggleReminderRuleInput = z.infer<typeof toggleReminderRuleInputSchema>;

/** Aperçu par canal d'un modèle par défaut (clé brute, sans rendu de variables) pour l'éditeur de règle. */
export const previewReminderTemplateInputSchema = z.object({
  key: z.string().trim().min(1),
});
export type PreviewReminderTemplateInput = z.infer<typeof previewReminderTemplateInputSchema>;

export const simulateReminderRuleInputSchema = z.object({
  rule: upsertReminderRuleInputSchema,
  days: z.number().int().min(1).max(90).default(30),
});
export type SimulateReminderRuleInput = z.infer<typeof simulateReminderRuleInputSchema>;

/** Onglets de la file « Relances du jour » (M10 §7.1). */
export const reminderQueueTabSchema = z.enum([
  "NEEDS_APPROVAL",
  "PLANNED_TODAY",
  "SENT_TODAY",
  "FAILED",
  "CALL_LIST",
  "EXPIRED",
]);
export type ReminderQueueTab = z.infer<typeof reminderQueueTabSchema>;

export const reminderQueueInputSchema = z.object({
  tab: reminderQueueTabSchema,
  types: z.array(reminderTypeSchema).optional(),
  channels: z.array(reminderChannelSchema).optional(),
  siteId: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ReminderQueueInput = z.infer<typeof reminderQueueInputSchema>;

export const getReminderInputSchema = z.object({ id: z.string().trim().min(1) });
export type GetReminderInput = z.infer<typeof getReminderInputSchema>;

export const previewReminderInputSchema = z.object({
  id: z.string().trim().min(1),
  channel: reminderChannelSchema,
});
export type PreviewReminderInput = z.infer<typeof previewReminderInputSchema>;

export const approveRemindersInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  sendNow: z.boolean().optional(),
});
export type ApproveRemindersInput = z.infer<typeof approveRemindersInputSchema>;

export const updateReminderInputSchema = z.object({
  id: z.string().trim().min(1),
  body: z.string().trim().min(1).max(4000).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  channel: reminderChannelSchema.optional(),
});
export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

export const snoozeRemindersInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  until: z.coerce.date(),
});
export type SnoozeRemindersInput = z.infer<typeof snoozeRemindersInputSchema>;

export const skipRemindersInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  reason: z.string().trim().min(1).max(300),
  stopSequence: z.boolean().optional(),
});
export type SkipRemindersInput = z.infer<typeof skipRemindersInputSchema>;

export const retryReminderInputSchema = z.object({ id: z.string().trim().min(1) });
export type RetryReminderInput = z.infer<typeof retryReminderInputSchema>;

export const createManualReminderInputSchema = z.object({
  customerId: z.string().trim().min(1),
  type: reminderTypeSchema,
  vehicleId: z.string().trim().min(1).optional(),
  invoiceId: z.string().trim().min(1).optional(),
  templateKey: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  channel: reminderChannelSchema.optional(),
});
export type CreateManualReminderInput = z.infer<typeof createManualReminderInputSchema>;

export const markWaLinkSentInputSchema = z.object({ id: z.string().trim().min(1) });
export type MarkWaLinkSentInput = z.infer<typeof markWaLinkSentInputSchema>;

export const dueDatesKindSchema = z.enum(["INSPECTION", "SERVICE", "INSURANCE"]);
export const dueDatesFilterSchema = z.enum([
  "DUE_SOON_7",
  "DUE_SOON_30",
  "OVERDUE",
  "UPCOMING",
  "INCOMPLETE_DATA",
  "SUSPECT_DATE",
]);
export const dueDatesInputSchema = z.object({
  kind: dueDatesKindSchema,
  filter: dueDatesFilterSchema.optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d\d$/)
    .optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type DueDatesInput = z.infer<typeof dueDatesInputSchema>;

export const markAppointmentTakenInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date().optional(),
  createAppointment: z.boolean(),
});
export type MarkAppointmentTakenInput = z.infer<typeof markAppointmentTakenInputSchema>;

export const markInspectionDoneInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  expiryDate: z.coerce.date(),
  lastDate: z.coerce.date().optional(),
  center: z.string().trim().min(1).optional(),
});
export type MarkInspectionDoneInput = z.infer<typeof markInspectionDoneInputSchema>;

export const reminderStatsInputSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  siteId: z.string().trim().min(1).optional(),
});
export type ReminderStatsInput = z.infer<typeof reminderStatsInputSchema>;

/** Historique détaillé (ligne par relance) pour l'écran « Résultats des relances » (M10 §7.3). */
export const reminderHistoryStatusFilterSchema = z.enum(["SENT", "FAILED", "CANCELLED", "SKIPPED"]);
export const reminderHistoryInputSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  status: reminderHistoryStatusFilterSchema.optional(),
  type: reminderTypeSchema.optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ReminderHistoryInput = z.infer<typeof reminderHistoryInputSchema>;

/** `Organization.settings.reminders` (M10 §6) — mise à jour partielle. */
export const updateReminderSettingsInputSchema = z.object({
  approvalMode: z.enum(["PER_STEP", "MANUAL_ALL", "PAUSED"]).optional(),
  maxPerDay: z.number().int().min(1).optional(),
  maxPerWeek: z.number().int().min(1).optional(),
  minGapDays: z.number().int().min(0).optional(),
  catchUpDays: z.number().int().min(0).optional(),
  pauseOnReplyHours: z.number().int().min(0).optional(),
  maxDataAgeHours: z.number().int().min(1).optional(),
  defaultKmPerDay: z.number().int().min(1).optional(),
  serviceDefaults: z
    .object({ months: z.number().int().min(1), km: z.number().int().min(1) })
    .optional(),
  inspectionValidityMonths: z.number().int().min(1).optional(),
  holidays: z
    .array(z.object({ date: z.coerce.date(), siteId: z.string().nullable().optional() }))
    .optional(),
});
export type UpdateReminderSettingsInput = z.infer<typeof updateReminderSettingsInputSchema>;
