import { z } from "zod";
import { messageChannelSchema } from "./auth";

export const conversationStatusSchema = z.enum(["OPEN", "PENDING", "CLOSED"]);

export const conversationListInputSchema = z.object({
  filter: z.enum(["ALL", "UNREAD", "ASSIGNED_TO_ME", "UNASSIGNED"]).default("ALL"),
  channel: messageChannelSchema.optional(),
  search: z.string().trim().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type ConversationListInput = z.infer<typeof conversationListInputSchema>;

export const conversationGetInputSchema = z.object({
  id: z.string().trim().min(1),
  cursor: z.string().optional(),
});
export type ConversationGetInput = z.infer<typeof conversationGetInputSchema>;

export const conversationReplyInputSchema = z.object({
  conversationId: z.string().trim().min(1),
  body: z.string().trim().min(1),
  templateKey: z.string().trim().min(1).optional(),
});
export type ConversationReplyInput = z.infer<typeof conversationReplyInputSchema>;

export const conversationAssignInputSchema = z.object({
  conversationId: z.string().trim().min(1),
  assignedToId: z.string().trim().min(1).nullable(),
});
export type ConversationAssignInput = z.infer<typeof conversationAssignInputSchema>;

export const conversationSetStatusInputSchema = z.object({
  conversationId: z.string().trim().min(1),
  status: conversationStatusSchema,
});
export type ConversationSetStatusInput = z.infer<typeof conversationSetStatusInputSchema>;

export const conversationMarkReadInputSchema = z.object({
  conversationId: z.string().trim().min(1),
});
export type ConversationMarkReadInput = z.infer<typeof conversationMarkReadInputSchema>;

export const messagingSendInputSchema = z.object({
  customerId: z.string().trim().min(1),
  channel: messageChannelSchema.optional(),
  templateKey: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type MessagingSendInput = z.infer<typeof messagingSendInputSchema>;

export const waLinkInputSchema = z.object({
  customerId: z.string().trim().min(1),
  body: z.string().trim().min(1),
});
export type WaLinkInput = z.infer<typeof waLinkInputSchema>;

export const waLinkConfirmInputSchema = z.object({
  customerId: z.string().trim().min(1),
  body: z.string().trim().min(1),
  sent: z.boolean(),
});
export type WaLinkConfirmInput = z.infer<typeof waLinkConfirmInputSchema>;

export const messagingHistoryInputSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  channel: messageChannelSchema.optional(),
  customerId: z.string().trim().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type MessagingHistoryInput = z.infer<typeof messagingHistoryInputSchema>;

export const templateUpsertInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
  channel: messageChannelSchema,
  subject: z.string().trim().min(1).nullable().optional(),
  body: z.string().trim().min(1),
  isActive: z.boolean().default(true),
});
export type TemplateUpsertInput = z.infer<typeof templateUpsertInputSchema>;

export const templatePreviewInputSchema = z.object({
  key: z.string().trim().min(1).optional(),
  channel: messageChannelSchema,
  body: z.string().trim().min(1).optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type TemplatePreviewInput = z.infer<typeof templatePreviewInputSchema>;

export const templateListInputSchema = z.object({
  channel: messageChannelSchema.optional(),
});
export type TemplateListInput = z.infer<typeof templateListInputSchema>;

export const channelProviderSchema = z.enum([
  "console",
  "wa_link",
  "whatsapp_cloud",
  "orange_sms",
  "twilio",
  "http_sms",
  "resend",
  "smtp",
]);

export const channelUpsertInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  channel: messageChannelSchema,
  provider: channelProviderSchema,
  isActive: z.boolean().default(false),
  priority: z.number().int().min(1).default(1),
  senderId: z.string().trim().min(1).nullable().optional(),
  credentials: z.record(z.string(), z.unknown()).default({}),
});
export type ChannelUpsertInput = z.infer<typeof channelUpsertInputSchema>;

export const channelTestInputSchema = z.object({ id: z.string().trim().min(1) });
export type ChannelTestInput = z.infer<typeof channelTestInputSchema>;

export const optOutAddInputSchema = z.object({
  address: z.string().trim().min(1),
  channel: messageChannelSchema.nullable().optional(),
  reason: z.string().trim().min(1).optional(),
});
export type OptOutAddInput = z.infer<typeof optOutAddInputSchema>;

export const optOutRemoveInputSchema = z.object({ id: z.string().trim().min(1) });
export type OptOutRemoveInput = z.infer<typeof optOutRemoveInputSchema>;

export const quickReplyUpsertInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  shortcut: z
    .string()
    .trim()
    .min(2)
    .regex(
      /^\/[a-z0-9-]+$/,
      "Le raccourci doit commencer par « / » (lettres minuscules, chiffres, tirets).",
    ),
  body: z.string().trim().min(1),
  templateKey: z.string().trim().min(1).nullable().optional(),
});
export type QuickReplyUpsertInput = z.infer<typeof quickReplyUpsertInputSchema>;

export const quickReplyDeleteInputSchema = z.object({ id: z.string().trim().min(1) });
export type QuickReplyDeleteInput = z.infer<typeof quickReplyDeleteInputSchema>;

// Simulateurs /dev/outbox (RG-M11-26) : jamais exposés en production (route protégée par env).
// `providerMessageId` correspond à `OutboxEntry.id` (== `Message.providerMessageId`).
export const devOutboxSimulateInputSchema = z.object({
  providerMessageId: z.string().trim().min(1),
  outcome: z.enum(["DELIVERED", "READ", "FAILED_NOT_ON_WHATSAPP", "FAILED_GENERIC"]),
});
export type DevOutboxSimulateInput = z.infer<typeof devOutboxSimulateInputSchema>;

export const devOutboxSimulateReplyInputSchema = z.object({
  providerMessageId: z.string().trim().min(1),
  body: z.string().trim().min(1),
});
export type DevOutboxSimulateReplyInput = z.infer<typeof devOutboxSimulateReplyInputSchema>;
