import { z } from "zod";

export const taxRegimeSchema = z.enum(["RNI", "RSI", "RMI", "ENTREPRENANT"]);
export const operatingModeSchema = z.enum(["FULL", "REMINDERS_ONLY"]);

// RG-M15-01 : 7 chiffres + 1 lettre majuscule, bloquant (contrairement au RCCM qui n'est
// qu'un avertissement, cf. packages/core/organization/identity.ts, même règle dupliquée ici
// volontairement — précédent du projet pour les validateurs d'entrée, cf. site.ts).
const NCC_INPUT_REGEX = /^\d{7}[A-Z]$/;

export const updateOrgInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  legalName: z.string().trim().min(1).nullable().optional(),
  rccm: z.string().trim().min(1).nullable().optional(),
  ncc: z
    .string()
    .trim()
    .regex(NCC_INPUT_REGEX, "Le NCC doit contenir 7 chiffres suivis d'une lettre (ex. 1912345A).")
    .nullable()
    .optional(),
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
});
export type UpdateOrgInput = z.infer<typeof updateOrgInputSchema>;

// RG-M15-23 : la bascule de mode est une action dédiée (auditée, soumise à des conditions),
// séparée de org.update pour ne pas la glisser silencieusement dans une mise à jour générique.
export const setOperatingModeInputSchema = z.object({
  mode: operatingModeSchema,
  reason: z.string().trim().min(1).max(500),
});
export type SetOperatingModeInput = z.infer<typeof setOperatingModeInputSchema>;
