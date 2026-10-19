import { z } from "zod";

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
/** RG-M03-09 — canal de confirmation explicite. */
export const confirmViaSchema = z.enum(["phone", "whatsapp", "sms", "portal", "in_person"]);
export const cancelledBySchema = z.enum(["CUSTOMER", "GARAGE"]);
/** RG-M03-11 — motifs d'annulation côté garage (+ texte libre pour « Autre »). */
export const CANCEL_REASONS = [
  "Pièce non disponible",
  "Atelier surchargé",
  "Mécanicien absent",
  "Doublon",
  "Autre",
] as const;

const id = z.string().trim().min(1);
const durationSchema = z
  .number()
  .int()
  .min(15)
  .max(24 * 60);

export const appointmentListInputSchema = z.object({
  siteId: id,
  from: z.coerce.date(),
  to: z.coerce.date(),
  bayIds: z.array(id).optional(),
  mechanicIds: z.array(id).optional(),
  statuses: z.array(appointmentStatusSchema).optional(),
  types: z.array(appointmentTypeSchema).optional(),
  sources: z.array(appointmentSourceSchema).optional(),
});
export type AppointmentListInput = z.infer<typeof appointmentListInputSchema>;

export const appointmentGetInputSchema = z.object({ id });
export type AppointmentGetInput = z.infer<typeof appointmentGetInputSchema>;

export const appointmentCreateInputSchema = z.object({
  siteId: id,
  customerId: id,
  vehicleId: id.nullable().optional(),
  type: appointmentTypeSchema,
  startsAt: z.coerce.date(),
  durationMinutes: durationSchema.optional(),
  bayId: id.nullable().optional(),
  mechanicId: id.nullable().optional(),
  advisorId: id.nullable().optional(),
  complaint: z.string().trim().max(2000).nullable().optional(),
  laborOperationIds: z.array(id).max(50).default([]),
  source: appointmentSourceSchema.default("STAFF"),
  reminderId: id.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  notifyCustomer: z.boolean().default(true),
  /** Forçage (surréservation, hors horaires, capacité, doublon du jour) — permission planning:manage. */
  force: z.boolean().default(false),
});
export type AppointmentCreateInput = z.infer<typeof appointmentCreateInputSchema>;

export const appointmentUpdateInputSchema = z.object({
  id,
  startsAt: z.coerce.date().optional(),
  durationMinutes: durationSchema.optional(),
  bayId: id.nullable().optional(),
  mechanicId: id.nullable().optional(),
  advisorId: id.nullable().optional(),
  type: appointmentTypeSchema.optional(),
  vehicleId: id.nullable().optional(),
  complaint: z.string().trim().max(2000).nullable().optional(),
  laborOperationIds: z.array(id).max(50).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  notifyCustomer: z.boolean().default(true),
  force: z.boolean().default(false),
});
export type AppointmentUpdateInput = z.infer<typeof appointmentUpdateInputSchema>;

export const appointmentConfirmInputSchema = z.object({ id, via: confirmViaSchema });
export type AppointmentConfirmInput = z.infer<typeof appointmentConfirmInputSchema>;

export const appointmentMarkArrivedInputSchema = z.object({ id });
export const appointmentCompleteInputSchema = z.object({
  id,
  reason: z.string().trim().min(1).max(500),
});
export const appointmentCancelInputSchema = z.object({
  id,
  cancelledBy: cancelledBySchema,
  reason: z.string().trim().max(500).optional(),
  notifyCustomer: z.boolean().default(true),
});
export type AppointmentCancelInput = z.infer<typeof appointmentCancelInputSchema>;
export const appointmentMarkNoShowInputSchema = z.object({ id });
export const appointmentRevertNoShowInputSchema = z.object({
  id,
  reason: z.string().trim().min(1).max(500),
});
export const appointmentSendReminderNowInputSchema = z.object({ id });

export const appointmentCreateBatchInputSchema = z.object({
  siteId: id,
  customerId: id,
  /** Jour choisi (date civile, fuseau de l'organisation). */
  date: z.coerce.date(),
  vehicleIds: z.array(id).min(1).max(50),
  type: appointmentTypeSchema.default("INSPECTION_PREP"),
  maxParallel: z.number().int().min(1).max(10).default(2),
  notifyCustomer: z.boolean().default(true),
});
export type AppointmentCreateBatchInput = z.infer<typeof appointmentCreateBatchInputSchema>;

export const appointmentTodayInputSchema = z.object({
  siteId: id,
  date: z.coerce.date().optional(),
});
export type AppointmentTodayInput = z.infer<typeof appointmentTodayInputSchema>;
