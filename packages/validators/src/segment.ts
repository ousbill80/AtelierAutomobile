import { z } from "zod";

/** Mêmes clés que `customer.list` (RG-M02 §7 « segments »), stockées en Json. */
export const segmentFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  type: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  hasBalance: z.boolean().optional(),
  inspectionWithinDays: z.number().int().min(0).optional(),
  serviceDue: z.boolean().optional(),
  optedOut: z.boolean().optional(),
  commune: z.string().trim().min(1).optional(),
});
export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;

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
export type UpdateSegmentInput = z.infer<typeof updateSegmentInputSchema>;

export const deleteSegmentInputSchema = z.object({ id: z.string().trim().min(1) });
export type DeleteSegmentInput = z.infer<typeof deleteSegmentInputSchema>;

export const previewSegmentInputSchema = z.object({ filters: segmentFiltersSchema });
export type PreviewSegmentInput = z.infer<typeof previewSegmentInputSchema>;
