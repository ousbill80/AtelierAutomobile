import { z } from "zod";

// M03 §4/§8 — Rendez-vous et planning.

export const appointmentTypeSchema = z.enum([
  "SERVICE",
  "INSPECTION_PREP",
  "REPAIR",
  "DIAGNOSTIC",
  "BODYWORK",
  "TIRES",
  "OTHER",
]);
export const appointmentStatusSchema = z.enum([
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "NO_SHOW",
  "CANCELLED",
  "COMPLETED",
]);
export const appointmentSourceSchema = z.enum(["STAFF", "PHONE", "WHATSAPP", "PORTAL", "REMINDER"]);
export const appointmentConfirmViaSchema = z.enum([
  "phone",
  "whatsapp",
  "sms",
  "portal",
  "in_person",
]);
export const appointmentCancelledBySchema = z.enum(["CUSTOMER", "GARAGE"]);

export const appointmentListInputSchema = z.object({
  siteId: z.string().trim().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  bayIds: z.array(z.string().trim().min(1)).optional(),
  mechanicIds: z.array(z.string().trim().min(1)).optional(),
  statuses: z.array(appointmentStatusSchema).optional(),
  types: z.array(appointmentTypeSchema).optional(),
  sources: z.array(appointmentSourceSchema).optional(),
});
export type AppointmentListInput = z.infer<typeof appointmentListInputSchema>;

export const appointmentCreateInputSchema = z.object({
  siteId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1).optional(),
  type: appointmentTypeSchema,
  startsAt: z.coerce.date(),
  durationMinutes: z.number().int().positive().optional(),
  bayId: z.string().trim().min(1).optional(),
  mechanicId: z.string().trim().min(1).optional(),
  advisorId: z.string().trim().min(1).optional(),
  complaint: z.string().trim().min(1).optional(),
  laborOperationIds: z.array(z.string().trim().min(1)).optional(),
  source: appointmentSourceSchema,
  reminderId: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  notifyCustomer: z.boolean().optional().default(true),
  force: z.boolean().optional(),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateInputSchema>;

export const appointmentUpdateInputSchema = z.object({
  id: z.string().trim().min(1),
  startsAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().positive().optional(),
  bayId: z.string().trim().min(1).nullable().optional(),
  mechanicId: z.string().trim().min(1).nullable().optional(),
  type: appointmentTypeSchema.optional(),
  complaint: z.string().trim().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  notifyCustomer: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateInputSchema>;

export const appointmentConfirmInputSchema = z.object({
  id: z.string().trim().min(1),
  via: appointmentConfirmViaSchema,
});

export const appointmentIdInputSchema = z.object({ id: z.string().trim().min(1) });

export const appointmentCompleteInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const appointmentCancelInputSchema = z.object({
  id: z.string().trim().min(1),
  cancelledBy: appointmentCancelledBySchema,
  reason: z.string().trim().min(1),
  notifyCustomer: z.boolean().optional().default(true),
});

export const appointmentRevertNoShowInputSchema = z.object({
  id: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

export const appointmentCreateBatchInputSchema = z.object({
  siteId: z.string().trim().min(1),
  customerId: z.string().trim().min(1),
  date: z.coerce.date(),
  vehicleIds: z.array(z.string().trim().min(1)).min(1),
  type: appointmentTypeSchema,
  maxParallel: z.number().int().positive().optional().default(2),
});

export const planningAvailableSlotsInputSchema = z.object({
  siteId: z.string().trim().min(1),
  type: appointmentTypeSchema,
  durationMinutes: z.number().int().positive().optional(),
  from: z.coerce.date(),
  days: z.number().int().min(1).max(31).optional(),
  bayType: z.string().trim().min(1).optional(),
  mechanicId: z.string().trim().min(1).optional(),
});

export const planningCapacityInputSchema = z.object({
  siteId: z.string().trim().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export const resourceBlockListInputSchema = z.object({
  siteId: z.string().trim().min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const resourceBlockCreateInputSchema = z.object({
  siteId: z.string().trim().min(1),
  bayId: z.string().trim().min(1).optional(),
  membershipId: z.string().trim().min(1).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().min(1),
});
export const resourceBlockDeleteInputSchema = z.object({ id: z.string().trim().min(1) });

// §6 — paramètres planning (`Organization.settings.appointments` / `.planning`). Les jours
// fériés ne sont PAS ici : source unique `Holiday` (A1, M15).
export const appointmentDurationsSchema = z.object({
  SERVICE: z.number().int().positive(),
  INSPECTION_PREP: z.number().int().positive(),
  REPAIR: z.number().int().positive(),
  DIAGNOSTIC: z.number().int().positive(),
  BODYWORK: z.number().int().positive(),
  TIRES: z.number().int().positive(),
  OTHER: z.number().int().positive(),
});

export const planningSettingsSchema = z.object({
  appointments: z.object({
    durations: appointmentDurationsSchema,
    slotStepMinutes: z.number().int().positive(),
    lateAfterMinutes: z.number().int().positive(),
    noShowJobTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    portalEnabled: z.boolean(),
    portalTypes: z.array(appointmentTypeSchema),
    portalRequiresApproval: z.boolean(),
    portalMinLeadHours: z.number().int().min(0),
    portalHorizonDays: z.number().int().min(1).max(31),
    autoAssignBay: z.boolean(),
    maxAppointmentsPerHalfDay: z.number().int().positive().nullable(),
  }),
  planning: z.object({
    productivityRate: z.number().min(0).max(1),
    lunchBreak: z.tuple([z.string(), z.string()]).nullable(),
  }),
});
export type PlanningSettings = z.infer<typeof planningSettingsSchema>;

export const DEFAULT_PLANNING_SETTINGS: PlanningSettings = {
  appointments: {
    durations: {
      SERVICE: 90,
      INSPECTION_PREP: 60,
      REPAIR: 120,
      DIAGNOSTIC: 60,
      BODYWORK: 30,
      TIRES: 45,
      OTHER: 60,
    },
    slotStepMinutes: 15,
    lateAfterMinutes: 60,
    noShowJobTime: "20:00",
    portalEnabled: true,
    portalTypes: ["SERVICE", "INSPECTION_PREP", "DIAGNOSTIC", "TIRES"],
    portalRequiresApproval: false,
    portalMinLeadHours: 2,
    portalHorizonDays: 14,
    autoAssignBay: false,
    maxAppointmentsPerHalfDay: null,
  },
  planning: {
    productivityRate: 0.85,
    lunchBreak: null,
  },
};

export const planningSettingsUpdateInputSchema = planningSettingsSchema;
