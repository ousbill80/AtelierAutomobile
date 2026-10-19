import { z } from "zod";

const segmentFiltersSchema = z.record(z.string(), z.unknown());

export const createSegmentInputSchema = z.object({
  name: z.string().trim().min(1),
  filters: segmentFiltersSchema,
});
export type CreateSegmentInput = z.infer<typeof createSegmentInputSchema>;

export const updateSegmentInputSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  filters: segmentFiltersSchema.optional(),
});

export const deleteSegmentInputSchema = z.object({ id: z.string().trim().min(1) });

export const previewSegmentInputSchema = z.object({ filters: segmentFiltersSchema });

export const searchGlobalInputSchema = z.object({
  q: z.string().trim().min(2, "Tapez au moins 2 caractères."),
  limit: z.number().int().min(1).max(5).default(5),
});
export type SearchGlobalInput = z.infer<typeof searchGlobalInputSchema>;
