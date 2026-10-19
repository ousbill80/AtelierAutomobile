import { z } from "zod";
import { messageChannelSchema } from "./auth";

// RG-M10-01
export const reminderTypeSchema = z.enum([
  "INSPECTION",
  "SERVICE",
  "RECEIVABLE",
  "APPOINTMENT",
  "QUOTE_FOLLOWUP",
  "VEHICLE_READY",
  "INSURANCE_EXPIRY",
  "SATISFACTION",
  "RECOMMENDED_WORK",
  "CUSTOM",
]);
export type ReminderTypeInput = z.infer<typeof reminderTypeSchema>;

export const reminderStatusSchema = z.enum([
  "PLANNED",
  "NEEDS_APPROVAL",
  "QUEUED",
  "SENT",
  "FAILED",
  "SKIPPED",
  "SNOOZED",
  "CANCELLED",
]);

export const reminderOutcomeSchema = z.enum([
  "APPOINTMENT_BOOKED",
  "PAID",
  "PARTIALLY_PAID",
  "PROMISED",
  "REPLIED",
  "NO_RESPONSE",
  "OPTED_OUT",
  "VISITED",
  "QUOTE_ACCEPTED",
  "VEHICLE_PICKED_UP",
]);

// RG-M10-23 : liste blanche des événements acceptés dans ReminderRule.stopOn.
export const reminderStopEventSchema = z.enum([
  "appointment.created",
  "appointment.cancelled",
  "appointment.updated",
  "repair_order.created",
  "vehicle.inspection_updated",
  "vehicle.service_recorded",
  "vehicle.owner_changed",
  "vehicle.insurance_updated",
  "payment.received",
  "collection.promised",
  "collection.disputed",
  "collection.paused",
  "quote.accepted",
  "quote.declined",
  "quote.expired",
  "repair_order.status_changed",
  "message.inbound_received",
  "customer.updated",
]);

const stepAttachmentSchema = z.enum(["statement", "formal_notice", "invoice"]);

// RG-M10-03
export const reminderStepSchema = z
  .object({
    key: z.string().regex(/^[A-Z0-9+\-_]{1,16}$/),
    label: z.string().trim().min(1),
    offsetDays: z.number().int().min(-365).max(365),
    offsetHours: z.number().int().optional(),
    anchor: z.enum(["default", "sentAt", "validUntil"]).default("default"),
    templateKey: z.string().trim().min(1),
    autoSend: z.boolean(),
    channels: z.array(messageChannelSchema),
    internalOnly: z.boolean().default(false),
    requiresPermission: z.string().trim().min(1).optional(),
    attachments: z.array(stepAttachmentSchema).default([]),
    catchUpDays: z.number().int().min(0).optional(),
    sendAt: z
      .string()
      .regex(/^\d\d:\d\d$/)
      .optional(),
  })
  .refine((step) => !step.internalOnly || step.channels.length === 0, {
    message: "Un palier interne (internalOnly) ne peut pas avoir de canaux.",
    path: ["channels"],
  });
export type ReminderStepInput = z.infer<typeof reminderStepSchema>;

export const reminderSendWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: z.string().regex(/^\d\d:\d\d$/),
  to: z.string().regex(/^\d\d:\d\d$/),
  preferredTime: z.string().regex(/^\d\d:\d\d$/),
});
export type ReminderSendWindowInput = z.infer<typeof reminderSendWindowSchema>;

export const reminderRuleConditionsSchema = z.object({
  customerTypes: z.array(z.enum(["INDIVIDUAL", "COMPANY"])).optional(),
  minAmount: z.number().int().min(0).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  excludeTags: z.array(z.string().trim().min(1)).optional(),
  siteIds: z.array(z.string().trim().min(1)).optional(),
  vehicleMinYear: z.number().int().optional(),
  digest: z.enum(["monthly"]).optional(),
});
export type ReminderRuleConditionsInput = z.infer<typeof reminderRuleConditionsSchema>;

const stepsArraySchema = z
  .array(reminderStepSchema)
  .min(1)
  .max(8)
  .superRefine((steps, ctx) => {
    const keys = steps.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: "custom",
        message: "Les clés de palier (key) doivent être uniques dans une règle.",
      });
    }
    for (let i = 1; i < steps.length; i += 1) {
      if (steps[i]!.offsetDays <= steps[i - 1]!.offsetDays) {
        ctx.addIssue({
          code: "custom",
          message: "Les décalages (offsetDays) doivent être strictement croissants.",
          path: [i, "offsetDays"],
        });
      }
    }
  });

export const reminderRuleUpsertInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  type: reminderTypeSchema,
  name: z.string().trim().min(1),
  isActive: z.boolean().default(true),
  steps: stepsArraySchema,
  sendWindow: reminderSendWindowSchema,
  conditions: reminderRuleConditionsSchema.default({}),
  stopOn: z.array(reminderStopEventSchema).default([]),
});
export type ReminderRuleUpsertInput = z.infer<typeof reminderRuleUpsertInputSchema>;

export const reminderRuleGetInputSchema = z.object({ id: z.string().trim().min(1) });

export const reminderRuleToggleInputSchema = z.object({
  id: z.string().trim().min(1),
  isActive: z.boolean(),
});
export type ReminderRuleToggleInput = z.infer<typeof reminderRuleToggleInputSchema>;

export const reminderRuleSimulateInputSchema = z.object({
  rule: reminderRuleUpsertInputSchema,
  days: z.number().int().min(1).max(90).default(30),
});
export type ReminderRuleSimulateInput = z.infer<typeof reminderRuleSimulateInputSchema>;

// §6 Organization.settings.reminders
export const reminderSettingsSchema = z.object({
  approvalMode: z.enum(["PER_STEP", "MANUAL_ALL", "PAUSED"]).default("PER_STEP"),
  warmupUntil: z.string().trim().min(1).nullable().default(null),
  maxPerDay: z.number().int().min(1).default(1),
  maxPerWeek: z.number().int().min(1).default(3),
  minGapDays: z.number().int().min(0).default(3),
  catchUpDays: z.number().int().min(0).default(7),
  pauseOnReplyHours: z.number().int().min(0).default(48),
  maxDataAgeHours: z.number().int().min(1).default(48),
  defaultKmPerDay: z.number().int().min(1).default(40),
  serviceDefaults: z
    .object({ months: z.number().int().min(1), km: z.number().int().min(1) })
    .default({ months: 6, km: 10_000 }),
  inspectionValidityMonths: z.number().int().min(1).default(12),
  holidays: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d\d-\d\d$/),
        label: z.string().trim().min(1),
        estimated: z.boolean().default(false),
        siteId: z.string().trim().min(1).nullable().optional(),
      }),
    )
    .default([]),
  attributionDays: z
    .object({
      INSPECTION: z.number().int().min(1),
      SERVICE: z.number().int().min(1),
      RECEIVABLE: z.number().int().min(1),
      QUOTE_FOLLOWUP: z.number().int().min(1),
    })
    // A10 : la fenêtre RECEIVABLE suit la règle M12 (14 j).
    .default({ INSPECTION: 30, SERVICE: 30, RECEIVABLE: 14, QUOTE_FOLLOWUP: 7 }),
});
export type ReminderSettingsInput = z.infer<typeof reminderSettingsSchema>;
export const DEFAULT_REMINDER_SETTINGS: ReminderSettingsInput = reminderSettingsSchema.parse({});

export const reminderSettingsUpdateInputSchema = reminderSettingsSchema.partial();
export type ReminderSettingsUpdateInput = z.infer<typeof reminderSettingsUpdateInputSchema>;

// apps/web/server/routers/reminders.ts — procédures (§8)

export const reminderTabSchema = z.enum([
  "TO_APPROVE",
  "PLANNED_TODAY",
  "SENT_TODAY",
  "FAILED",
  "TO_CALL",
  "EXPIRED",
]);

export const reminderQueueInputSchema = z.object({
  tab: reminderTabSchema,
  types: z.array(reminderTypeSchema).optional(),
  channels: z.array(messageChannelSchema).optional(),
  siteId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  vehicleId: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type ReminderQueueInput = z.infer<typeof reminderQueueInputSchema>;

export const reminderGetInputSchema = z.object({ id: z.string().trim().min(1) });

export const reminderPreviewInputSchema = z.object({
  id: z.string().trim().min(1),
  channel: messageChannelSchema,
});

export const reminderApproveInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  sendNow: z.boolean().default(false),
});
export type ReminderApproveInput = z.infer<typeof reminderApproveInputSchema>;

export const reminderUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  body: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  channel: messageChannelSchema.optional(),
});
export type ReminderUpdateInput = z.infer<typeof reminderUpdateInputSchema>;

export const reminderSnoozeInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  until: z.coerce.date(),
});
export type ReminderSnoozeInput = z.infer<typeof reminderSnoozeInputSchema>;

export const REMINDER_SKIP_REASONS = [
  "Client déjà venu",
  "Déjà payé",
  "Mauvais numéro",
  "Client vendu le véhicule",
  "Autre",
] as const;
export const reminderSkipReasonSchema = z.enum(REMINDER_SKIP_REASONS);

export const reminderSkipInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
  reason: z.string().trim().min(1),
  stopSequence: z.boolean().default(false),
});
export type ReminderSkipInput = z.infer<typeof reminderSkipInputSchema>;

export const reminderRetryInputSchema = z.object({ id: z.string().trim().min(1) });

export const reminderCreateManualInputSchema = z.object({
  customerId: z.string().trim().min(1),
  type: reminderTypeSchema,
  vehicleId: z.string().trim().min(1).optional(),
  caseId: z.string().trim().min(1).optional(),
  templateKey: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
  channel: messageChannelSchema.optional(),
});
export type ReminderCreateManualInput = z.infer<typeof reminderCreateManualInputSchema>;

export const reminderMarkWaLinkSentInputSchema = z.object({ id: z.string().trim().min(1) });

export const reminderDueDatesInputSchema = z.object({
  kind: z.enum(["INSPECTION", "SERVICE", "INSURANCE"]),
  filter: z.enum(["ALL", "UPCOMING", "EXPIRED", "MISSING_DATA"]).default("ALL"),
  month: z
    .string()
    .regex(/^\d{4}-\d\d$/)
    .optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type ReminderDueDatesInput = z.infer<typeof reminderDueDatesInputSchema>;

export const reminderMarkAppointmentTakenInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  date: z.coerce.date().optional(),
  createAppointment: z.boolean().default(false),
});
export type ReminderMarkAppointmentTakenInput = z.infer<
  typeof reminderMarkAppointmentTakenInputSchema
>;

export const reminderMarkInspectionDoneInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  expiryDate: z.coerce.date(),
  lastDate: z.coerce.date().optional(),
  center: z.string().trim().min(1).optional(),
});
export type ReminderMarkInspectionDoneInput = z.infer<typeof reminderMarkInspectionDoneInputSchema>;

export const reminderStatsInputSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  siteId: z.string().trim().min(1).optional(),
});
export type ReminderStatsInput = z.infer<typeof reminderStatsInputSchema>;

/** Statuts « terminés » affichés sur la page Résultats des relances. */
export const reminderHistoryStatusSchema = z.enum(["SENT", "FAILED", "CANCELLED", "SKIPPED"]);

/**
 * Page « Résultats des relances » : relances terminées dont la date d'activité (`sentAt`, sinon
 * dernière mise à jour) tombe dans [from, to].
 */
export const reminderHistoryInputSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    status: reminderHistoryStatusSchema.optional(),
    type: reminderTypeSchema.optional(),
    channel: messageChannelSchema.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .refine((input) => input.from <= input.to, {
    message: "La date de début doit précéder la date de fin.",
    path: ["from"],
  });
export type ReminderHistoryInput = z.infer<typeof reminderHistoryInputSchema>;
