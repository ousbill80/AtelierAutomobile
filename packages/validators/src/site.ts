import { z } from "zod";

export const bayTypeSchema = z.enum(["LIFT", "DIAGNOSTIC", "BODYWORK", "PAINT", "WASH", "OTHER"]);

const timeRangeSchema = z.tuple([z.string(), z.string()]);
export const openingHoursSchema = z.record(z.string(), z.array(timeRangeSchema));

export const createBayInputSchema = z.object({
  name: z.string().trim().min(1),
  type: bayTypeSchema.default("LIFT"),
});
export type CreateBayInput = z.infer<typeof createBayInputSchema>;

export const updateBayInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  type: bayTypeSchema,
  isActive: z.boolean().default(true),
});
export type UpdateBayInput = z.infer<typeof updateBayInputSchema>;

export const createSiteInputSchema = z.object({
  name: z.string().trim().min(1),
  code: z
    .string()
    .trim()
    // RG-M15-05 : 2 à 5 lettres majuscules (préfixe de numérotation, ex. "YOP").
    .regex(/^[A-Z]{2,5}$/, "Le code doit contenir de 2 à 5 lettres majuscules (ex. YOP)."),
  address: z.string().trim().min(1).nullable().optional(),
  commune: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  whatsappNumber: z.string().trim().min(1).nullable().optional(),
  openingHours: openingHoursSchema.optional(),
  bays: z.array(createBayInputSchema).default([]),
});
export type CreateSiteInput = z.infer<typeof createSiteInputSchema>;

export const updateSiteInputSchema = z.object({
  siteId: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  code: z
    .string()
    .trim()
    // RG-M15-05 : 2 à 5 lettres majuscules (préfixe de numérotation, ex. "YOP").
    .regex(/^[A-Z]{2,5}$/, "Le code doit contenir de 2 à 5 lettres majuscules (ex. YOP).")
    .optional(),
  address: z.string().trim().min(1).nullable().optional(),
  commune: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  whatsappNumber: z.string().trim().min(1).nullable().optional(),
  openingHours: openingHoursSchema.optional(),
  bays: z.array(updateBayInputSchema).optional(),
});
export type UpdateSiteInput = z.infer<typeof updateSiteInputSchema>;

export const deactivateSiteInputSchema = z.object({
  siteId: z.string().trim().min(1),
});
export type DeactivateSiteInput = z.infer<typeof deactivateSiteInputSchema>;
