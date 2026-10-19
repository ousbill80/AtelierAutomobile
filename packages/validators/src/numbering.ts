import { z } from "zod";

// RG-M15-12 — doit rester synchronisé avec `DocumentType` de packages/core/numbering.ts.
export const documentTypeSchema = z.enum([
  "OR",
  "DEV",
  "BC",
  "FAC",
  "AV",
  "REC",
  "INV",
  "TR",
  "SIN",
]);

export const updateNumberingInputSchema = z.object({
  docType: documentTypeSchema,
  prefix: z.string().trim().min(1).max(10),
  pattern: z.string().trim().min(1).max(60),
  padding: z.number().int().min(1).max(10),
  perSite: z.boolean(),
  resetYearly: z.boolean(),
  /** Nouvelle valeur de départ de la séquence (année en cours) ; seulement à la hausse (RG-M15-06). */
  startAt: z.number().int().positive().optional(),
});
export type UpdateNumberingInput = z.infer<typeof updateNumberingInputSchema>;
