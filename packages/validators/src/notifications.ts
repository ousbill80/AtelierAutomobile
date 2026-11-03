import { z } from "zod";

// Cloche de notifications (in-app) et abonnements Web Push de la PWA.

export const notificationListInputSchema = z.object({
  unreadOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type NotificationListInput = z.infer<typeof notificationListInputSchema>;

export const notificationMarkReadInputSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(100),
});

export const pushSubscribeInputSchema = z.object({
  endpoint: z.string().url().max(2048).startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(256),
  }),
  userAgent: z.string().max(300).optional(),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeInputSchema>;

export const pushUnsubscribeInputSchema = z.object({
  endpoint: z.string().url().max(2048),
});
