import { z } from "zod";

export const catalogMakesInputSchema = z.object({ q: z.string().trim().min(1).optional() });

export const catalogModelsInputSchema = z.object({
  makeId: z.string().trim().min(1),
  q: z.string().trim().min(1).optional(),
});

export const addLocalModelInputSchema = z.object({
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  serviceIntervalKm: z.number().int().positive().optional(),
  serviceIntervalMonths: z.number().int().positive().optional(),
});
export type AddLocalModelInput = z.infer<typeof addLocalModelInputSchema>;
