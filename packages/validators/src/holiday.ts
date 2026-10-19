import { z } from "zod";

// RG-M15-08 — jours fériés (modèle Holiday, M15 §14). `kind` : PUBLIC (jour férié légal) ou
// CLOSURE (fermeture exceptionnelle propre au garage, ex. inventaire annuel).
export const holidayKindSchema = z.enum(["PUBLIC", "CLOSURE"]);

export const listHolidaysInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  siteId: z.string().trim().min(1).optional(),
});
export type ListHolidaysInput = z.infer<typeof listHolidaysInputSchema>;

export const createHolidayInputSchema = z.object({
  date: z.coerce.date(),
  name: z.string().trim().min(1).max(200),
  kind: holidayKindSchema.default("PUBLIC"),
  /** `null`/absent = tous les sites de l'organisation. */
  siteId: z.string().trim().min(1).nullable().optional(),
  isEstimated: z.boolean().default(false),
});
export type CreateHolidayInput = z.infer<typeof createHolidayInputSchema>;

export const updateHolidayInputSchema = z.object({
  holidayId: z.string().trim().min(1),
  date: z.coerce.date().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  kind: holidayKindSchema.optional(),
  isEstimated: z.boolean().optional(),
});
export type UpdateHolidayInput = z.infer<typeof updateHolidayInputSchema>;

export const deleteHolidayInputSchema = z.object({
  holidayId: z.string().trim().min(1),
});
export type DeleteHolidayInput = z.infer<typeof deleteHolidayInputSchema>;

export const seedHolidayYearInputSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});
export type SeedHolidayYearInput = z.infer<typeof seedHolidayYearInputSchema>;
