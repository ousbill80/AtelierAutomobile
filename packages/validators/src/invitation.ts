import { z } from "zod";

export const invitationPreviewInputSchema = z.object({
  token: z.string().trim().min(1),
});
export type InvitationPreviewInput = z.infer<typeof invitationPreviewInputSchema>;

export const acceptInvitationInputSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8).max(100).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationInputSchema>;
