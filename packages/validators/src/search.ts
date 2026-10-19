import { z } from "zod";

/** RG-M02-19 — recherche globale. 2 caractères minimum ("Tapez au moins 2 caractères."). */
export const searchGlobalInputSchema = z.object({
  q: z.string().trim().min(2),
  limit: z.number().int().min(1).max(5).default(5),
});
export type SearchGlobalInput = z.infer<typeof searchGlobalInputSchema>;
