import { z } from "zod";
import { appointmentTypeSchema } from "./appointment";
import { bayTypeSchema } from "./site";

const id = z.string().trim().min(1);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format attendu : HH:MM");

export const availableSlotsInputSchema = z.object({
  siteId: id,
  type: appointmentTypeSchema,
  durationMinutes: z
    .number()
    .int()
    .min(15)
    .max(24 * 60)
    .optional(),
  from: z.coerce.date(),
  days: z.number().int().min(1).max(31).default(14),
  bayType: bayTypeSchema.optional(),
  bayId: id.optional(),
  mechanicId: id.optional(),
  /** Nombre maximal de créneaux (assistant « 10 prochains créneaux »). */
  limit: z.number().int().min(1).max(200).optional(),
  /** Exiger un pont compatible libre (défaut : vrai pour le personnel). */
  requireBay: z.boolean().default(true),
});
export type AvailableSlotsInput = z.infer<typeof availableSlotsInputSchema>;

export const capacityInputSchema = z.object({
  siteId: id,
  from: z.coerce.date(),
  to: z.coerce.date(),
});
export type CapacityInput = z.infer<typeof capacityInputSchema>;

export const suggestSlotInputSchema = z.object({
  siteId: id,
  customerId: id,
  vehicleId: id.optional(),
  type: appointmentTypeSchema,
  /** Texte libre du client (« samedi matin ») — M17 ; en v1 : recherche déterministe. */
  preferredText: z.string().trim().max(500).optional(),
  conversationId: id.optional(),
});
export type SuggestSlotInput = z.infer<typeof suggestSlotInputSchema>;

/** `settings.appointments` (M03 §6). */
export const appointmentSettingsSchema = z.object({
  durations: z.record(
    appointmentTypeSchema,
    z
      .number()
      .int()
      .min(15)
      .max(24 * 60),
  ),
  slotStepMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
  lateAfterMinutes: z.number().int().min(0).max(240),
  noShowJobTime: timeSchema,
  portalEnabled: z.boolean(),
  portalTypes: z.array(appointmentTypeSchema),
  portalRequiresApproval: z.boolean(),
  portalMinLeadHours: z.number().int().min(0).max(168),
  portalHorizonDays: z.number().int().min(1).max(60),
  autoAssignBay: z.boolean(),
  maxAppointmentsPerHalfDay: z.number().int().min(1).max(100).nullable(),
});
export type AppointmentSettingsInput = z.infer<typeof appointmentSettingsSchema>;

/** `settings.planning` (M03 §6). */
export const planningSettingsSchema = z.object({
  productivityRate: z.number().min(0.1).max(1),
  lunchBreak: z.tuple([timeSchema, timeSchema]).nullable(),
});
export type PlanningSettingsInput = z.infer<typeof planningSettingsSchema>;

export const updatePlanningSettingsInputSchema = z.object({
  appointments: appointmentSettingsSchema.partial().optional(),
  planning: planningSettingsSchema.partial().optional(),
});
export type UpdatePlanningSettingsInput = z.infer<typeof updatePlanningSettingsInputSchema>;

export const resourceBlockListInputSchema = z.object({
  siteId: id,
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ResourceBlockListInput = z.infer<typeof resourceBlockListInputSchema>;

export const resourceBlockCreateInputSchema = z
  .object({
    siteId: id,
    bayId: id.nullable().optional(),
    membershipId: id.nullable().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(1).max(200),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "La fin doit être après le début.",
    path: ["endsAt"],
  })
  .refine((v) => !(v.bayId && v.membershipId), {
    message:
      "Un blocage vise un pont, un mécanicien ou le site entier, pas un pont et un mécanicien à la fois.",
    path: ["membershipId"],
  });
export type ResourceBlockCreateInput = z.infer<typeof resourceBlockCreateInputSchema>;

export const resourceBlockDeleteInputSchema = z.object({ id });
