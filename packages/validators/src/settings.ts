import { z } from "zod";

// `OrganizationSettingsSchema` (M15 §6) valide tout `Organization.settings`. Cette étape (1.2)
// n'implémente que la section `tax` (RG-M15-02) : les autres sections (documents, labor,
// payments, channels, portal, reports, ai, atelier, stock, security, onboarding, costs…)
// appartiennent à des modules pas encore construits et seront ajoutées par eux (étape 6.5 et
// suivantes), chacune complétant `settingsSectionSchema` et `SettingsBySection` ci-dessous.

export const taxRoundingSchema = z.enum(["PER_LINE", "PER_DOCUMENT"]);

/** RG-M15-02 — `settings.tax` : taux secondaires proposés + mode d'arrondi. */
export const taxSettingsSchema = z.object({
  rates: z.array(z.number().int().min(0).max(100)).min(1).max(5),
  rounding: taxRoundingSchema,
});
export type TaxSettings = z.infer<typeof taxSettingsSchema>;

export const DEFAULT_TAX_SETTINGS: TaxSettings = { rates: [18, 9, 0], rounding: "PER_LINE" };

export const settingsSectionSchema = z.enum(["tax"]);
export type SettingsSection = z.infer<typeof settingsSectionSchema>;

export const getSettingsInputSchema = z.object({
  section: settingsSectionSchema.optional(),
});
export type GetSettingsInput = z.infer<typeof getSettingsInputSchema>;

export const updateSettingsInputSchema = z.object({
  section: z.literal("tax"),
  values: taxSettingsSchema.partial(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>;
