import { z } from "zod";

export const setActiveOrganizationInputSchema = z.object({
  organizationId: z.string().trim().min(1),
});
export type SetActiveOrganizationInput = z.infer<typeof setActiveOrganizationInputSchema>;

export const setActiveSiteInputSchema = z.object({
  siteId: z.string().trim().min(1).nullable(),
});
export type SetActiveSiteInput = z.infer<typeof setActiveSiteInputSchema>;

export const revokeSessionInputSchema = z.object({
  sessionId: z.string().trim().min(1),
});
export type RevokeSessionInput = z.infer<typeof revokeSessionInputSchema>;
