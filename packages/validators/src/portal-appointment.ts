import { z } from "zod";
import { appointmentTypeSchema } from "./appointment";

/** Jeton clair du portail : 43 caractères base64url (RG-M14-01). */
export const portalTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{20,64}$/);

export const portalSlotsInputSchema = z.object({
  token: portalTokenSchema,
  type: appointmentTypeSchema.optional(),
});
export const portalBookInputSchema = z.object({
  token: portalTokenSchema,
  startsAt: z.coerce.date(),
  type: appointmentTypeSchema.optional(),
  comment: z.string().trim().max(1000).optional(),
});
export const portalAppointmentGetInputSchema = z.object({ token: portalTokenSchema });
export const portalAppointmentConfirmInputSchema = z.object({ token: portalTokenSchema });
export const portalAppointmentCancelInputSchema = z.object({ token: portalTokenSchema });
export const portalAppointmentRescheduleInputSchema = z.object({
  token: portalTokenSchema,
  startsAt: z.coerce.date(),
});

export const portalLinkCreateInputSchema = z.object({
  appointmentId: z.string().trim().min(1),
});
