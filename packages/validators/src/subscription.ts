import { z } from "zod";

// M15 §8 — plan, export complet, suppression de compte, accès support (étape 6.5).

export const planTierSchema = z.enum(["STARTER", "PRO", "NETWORK"]);

export const requestPlanChangeInputSchema = z.object({
  targetPlan: planTierSchema,
  message: z.string().trim().max(1000).optional(),
});
export type RequestPlanChangeInput = z.infer<typeof requestPlanChangeInputSchema>;

const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Le code de vérification contient 6 chiffres.");

export const dataExportRequestInputSchema = z.object({ otp: otpCodeSchema });
export type DataExportRequestInput = z.infer<typeof dataExportRequestInputSchema>;

export const requestDeletionInputSchema = z.object({
  confirmName: z.string().trim().min(1, "Saisissez le nom du garage."),
  otp: otpCodeSchema,
  reason: z.string().trim().max(500).optional(),
});
export type RequestDeletionInput = z.infer<typeof requestDeletionInputSchema>;

export const grantSupportAccessInputSchema = z.object({
  hours: z.number().int().min(1).max(24).default(24),
});
export type GrantSupportAccessInput = z.infer<typeof grantSupportAccessInputSchema>;
