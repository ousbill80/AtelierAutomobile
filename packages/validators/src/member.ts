import { z } from "zod";
import { messageChannelSchema } from "./auth";

export const roleSchema = z.enum([
  "OWNER",
  "MANAGER",
  "ADVISOR",
  "MECHANIC",
  "STOREKEEPER",
  "CASHIER",
  "ACCOUNTANT",
]);
export type RoleInput = z.infer<typeof roleSchema>;

export const memberStatusFilterSchema = z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE");

export const listMembersInputSchema = z.object({
  status: memberStatusFilterSchema.optional(),
  role: roleSchema.optional(),
  siteId: z.string().trim().min(1).optional(),
});
export type ListMembersInput = z.infer<typeof listMembersInputSchema>;

export const getMemberInputSchema = z.object({
  membershipId: z.string().trim().min(1),
});
export type GetMemberInput = z.infer<typeof getMemberInputSchema>;

export const inviteMemberInputSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    role: roleSchema,
    siteIds: z.array(z.string().trim().min(1)).default([]),
    channel: messageChannelSchema,
  })
  .refine((data) => Boolean(data.phone) || Boolean(data.email), {
    message: "Un numéro de téléphone ou un email est requis.",
    path: ["phone"],
  });
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>;

export const resendInvitationInputSchema = z.object({
  invitationId: z.string().trim().min(1),
});
export type ResendInvitationInput = z.infer<typeof resendInvitationInputSchema>;

export const revokeInvitationInputSchema = z.object({
  invitationId: z.string().trim().min(1),
});
export type RevokeInvitationInput = z.infer<typeof revokeInvitationInputSchema>;

export const updateMemberInputSchema = z.object({
  membershipId: z.string().trim().min(1),
  role: roleSchema.optional(),
  siteIds: z.array(z.string().trim().min(1)).optional(),
  permissions: z.array(z.string().trim().min(1)).optional(),
  hourlyCost: z.number().int().min(0).nullable().optional(),
  skills: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>;

export const deactivateMemberInputSchema = z.object({
  membershipId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type DeactivateMemberInput = z.infer<typeof deactivateMemberInputSchema>;

export const reactivateMemberInputSchema = z.object({
  membershipId: z.string().trim().min(1),
});
export type ReactivateMemberInput = z.infer<typeof reactivateMemberInputSchema>;

export const setPinInputSchema = z.object({
  membershipId: z.string().trim().min(1),
  pin: z.string().trim().length(4),
});
export type SetPinInput = z.infer<typeof setPinInputSchema>;

export const revokeAllSessionsInputSchema = z.object({
  membershipId: z.string().trim().min(1),
});
export type RevokeAllSessionsInput = z.infer<typeof revokeAllSessionsInputSchema>;
