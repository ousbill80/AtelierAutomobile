import { z } from "zod";

// M12 §8 — entrées du tableau de bord (partie 1, étape 2.4).
// Doit rester aligné sur PERIOD_PRESETS (packages/core/src/dashboard/period.ts).
export const dashboardPeriodSchema = z.enum(["today", "7d", "month", "prev_month", "30d"]);

export const dashboardInputSchema = z.object({
  period: dashboardPeriodSchema.default("month"),
  siteId: z.string().min(1).optional(),
});
export type DashboardInput = z.infer<typeof dashboardInputSchema>;

export const alertsListInputSchema = z.object({
  unreadOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(50).default(5),
});

export const alertsMarkReadInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
});

// M12 §6 — `Organization.settings.digest` (US-M12-08, RG-M12-30). Destinataires vides = tous
// les OWNER actifs.
export const digestSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("07:30"),
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).default("WHATSAPP"),
  recipients: z.array(z.string().min(1)).default([]),
});
export type DigestSettings = z.infer<typeof digestSettingsSchema>;
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = digestSettingsSchema.parse({});

export const digestUpdateSettingsInputSchema = digestSettingsSchema;
