import { z } from "zod";

// M03 §8 — schémas des procédures `appointment.*`, `planning.*`, `resourceBlock.*`,
// `planningSettings.*` et `portal.appointment.*`.

export const appointmentTypeSchema = z.enum([
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
]);
export type AppointmentTypeInput = z.infer<typeof appointmentTypeSchema>;

export const appointmentStatusSchema = z.enum([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "NO_SHOW",
  "CANCELLED",
  "COMPLETED",
]);
export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;

export const appointmentSourceSchema = z.enum(["STAFF", "PHONE", "WHATSAPP", "PORTAL", "REMINDER"]);
export type AppointmentSourceInput = z.infer<typeof appointmentSourceSchema>;

export const confirmationChannelSchema = z.enum([
  "phone",
  "whatsapp",
  "sms",
  "portal",
  "in_person",
]);

export const garageCancelReasonSchema = z.enum([
  "PART_UNAVAILABLE",
  "WORKSHOP_OVERLOADED",
  "MECHANIC_ABSENT",
  "DUPLICATE",
  "OTHER",
]);

const id = z.string().trim().min(1);
const duration = z
  .number()
  .int()
  .min(15)
  .max(12 * 60);

export const appointmentListInputSchema = z.object({
  siteId: id.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  bayIds: z.array(id).optional(),
  mechanicIds: z.array(id).optional(),
  statuses: z.array(appointmentStatusSchema).optional(),
  types: z.array(appointmentTypeSchema).optional(),
  sources: z.array(appointmentSourceSchema).optional(),
});
export type AppointmentListInput = z.infer<typeof appointmentListInputSchema>;

export const appointmentIdInputSchema = z.object({ id });

export const appointmentCreateInputSchema = z.object({
  siteId: id.optional(),
  customerId: id,
  vehicleId: id.nullable().optional(),
  type: appointmentTypeSchema.default("SERVICE"),
  startsAt: z.coerce.date(),
  durationMinutes: duration.optional(),
  bayId: id.nullable().optional(),
  mechanicId: id.nullable().optional(),
  advisorId: id.nullable().optional(),
  complaint: z.string().trim().max(2000).optional(),
  laborOperationIds: z.array(id).max(50).default([]),
  source: appointmentSourceSchema.default("STAFF"),
  reminderId: id.nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
  notifyCustomer: z.boolean().default(true),
  /** Forçage (planning:manage) : surréservation, hors horaires, capacité, doublon du jour. */
  force: z.boolean().default(false),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateInputSchema>;

export const appointmentUpdateInputSchema = z.object({
  id,
  startsAt: z.coerce.date().optional(),
  durationMinutes: duration.optional(),
  bayId: id.nullable().optional(),
  mechanicId: id.nullable().optional(),
  type: appointmentTypeSchema.optional(),
  complaint: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  notifyCustomer: z.boolean().default(true),
  force: z.boolean().default(false),
});
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateInputSchema>;

export const appointmentConfirmInputSchema = z.object({ id, via: confirmationChannelSchema });

export const appointmentCompleteInputSchema = z.object({
  id,
  reason: z.string().trim().min(3, "Indiquez un motif.").max(500),
});

export const appointmentCancelInputSchema = z
  .object({
    id,
    cancelledBy: z.enum(["CUSTOMER", "GARAGE"]),
    reasonCode: garageCancelReasonSchema.optional(),
    reason: z.string().trim().max(500).optional(),
    notifyCustomer: z.boolean().default(true),
  })
  .refine((v) => v.cancelledBy !== "GARAGE" || !!v.reasonCode, {
    message: "Le motif d'annulation est obligatoire pour le garage.",
    path: ["reasonCode"],
  })
  .refine((v) => v.reasonCode !== "OTHER" || !!v.reason, {
    message: "Précisez le motif.",
    path: ["reason"],
  });

export const appointmentRevertNoShowInputSchema = z.object({
  id,
  reason: z.string().trim().min(3, "Indiquez un motif.").max(500),
});

export const appointmentCreateBatchInputSchema = z.object({
  siteId: id.optional(),
  customerId: id,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vehicleIds: z.array(id).min(1).max(30),
  type: appointmentTypeSchema.default("INSPECTION_PREP"),
  maxParallel: z.number().int().min(1).max(10).default(2),
  notifyCustomer: z.boolean().default(true),
});

export const appointmentTodayInputSchema = z.object({
  siteId: id.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const availableSlotsInputSchema = z.object({
  siteId: id.optional(),
  type: appointmentTypeSchema,
  durationMinutes: duration.optional(),
  from: z.coerce.date().optional(),
  days: z.number().int().min(1).max(31).default(14),
  mechanicId: id.nullable().optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

export const planningCapacityInputSchema = z.object({
  siteId: id.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const suggestSlotInputSchema = z.object({
  customerId: id,
  vehicleId: id.nullable().optional(),
  type: appointmentTypeSchema,
  conversationId: id.optional(),
  preferredText: z.string().trim().max(500).optional(),
});

export const resourceBlockListInputSchema = z.object({
  siteId: id.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const resourceBlockCreateInputSchema = z
  .object({
    siteId: id.optional(),
    bayId: id.nullable().optional(),
    membershipId: id.nullable().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(2, "Indiquez un motif.").max(200),
    /** Créer le blocage même si des RDV sont en conflit (ils restent à déplacer). */
    force: z.boolean().default(false),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "La fin doit être après le début.",
    path: ["endsAt"],
  })
  .refine((v) => !(v.bayId && v.membershipId), {
    message: "Un blocage porte sur un pont ou sur un mécanicien, pas les deux.",
    path: ["membershipId"],
  });

export const resourceBlockDeleteInputSchema = z.object({ id });

const durationsSchema = z.object(
  Object.fromEntries(appointmentTypeSchema.options.map((t) => [t, duration])) as Record<
    AppointmentTypeInput,
    typeof duration
  >,
);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Format HH:MM attendu.");

export const planningSettingsSchema = z.object({
  appointments: z.object({
    durations: durationsSchema,
    slotStepMinutes: z
      .number()
      .int()
      .refine((v) => [15, 30, 60].includes(v), "Pas de 15, 30 ou 60 min."),
    lateAfterMinutes: z.number().int().min(15).max(240),
    noShowJobTime: hhmm,
    portalEnabled: z.boolean(),
    portalTypes: z.array(appointmentTypeSchema),
    portalRequiresApproval: z.boolean(),
    portalMinLeadHours: z.number().int().min(0).max(72),
    portalHorizonDays: z.number().int().min(1).max(60),
    autoAssignBay: z.boolean(),
    maxAppointmentsPerHalfDay: z.number().int().min(1).max(200).nullable(),
  }),
  planning: z.object({
    productivityRate: z.number().min(0.1).max(1),
    lunchBreak: z.tuple([hhmm, hhmm]).nullable(),
  }),
});
export type PlanningSettingsInput = z.infer<typeof planningSettingsSchema>;

export const portalTokenInputSchema = z.object({ token: z.string().trim().min(16).max(200) });

export const portalSlotsInputSchema = portalTokenInputSchema.extend({
  type: appointmentTypeSchema.optional(),
});

export const portalBookInputSchema = portalTokenInputSchema.extend({
  startsAt: z.coerce.date(),
  type: appointmentTypeSchema,
  comment: z.string().trim().max(500).optional(),
});

export const portalRescheduleInputSchema = portalTokenInputSchema.extend({
  startsAt: z.coerce.date(),
});
