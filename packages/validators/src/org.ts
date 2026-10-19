import { z } from "zod";

export const taxRegimeSchema = z.enum(["RNI", "RSI", "RMI", "ENTREPRENANT"]);
export const operatingModeSchema = z.enum(["FULL", "REMINDERS_ONLY"]);

export const updateOrgInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  legalName: z.string().trim().min(1).nullable().optional(),
  rccm: z.string().trim().min(1).nullable().optional(),
  ncc: z.string().trim().min(1).nullable().optional(),
  taxRegime: taxRegimeSchema.optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
  vatEnabled: z.boolean().optional(),
  currency: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(1).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  address: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  logoUrl: z.string().trim().min(1).nullable().optional(),
  invoiceFooter: z.string().trim().min(1).nullable().optional(),
  operatingMode: operatingModeSchema.optional(),
});
export type UpdateOrgInput = z.infer<typeof updateOrgInputSchema>;
