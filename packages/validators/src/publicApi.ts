// M13 §4.7–4.8 — API REST publique `/api/v1` (corps en snake_case, RG-M13-35) et procédures
// back-office `apiKeys.*` / `webhooks.*` (M13 §8).
import { z } from "zod";

const externalId = z.string().trim().min(1).max(191);
const source = z.string().trim().min(1).max(100);
const phone = z.string().trim().min(6).max(30);

export const apiCustomerCreateSchema = z
  .object({
    type: z.enum(["INDIVIDUAL", "COMPANY"]).default("INDIVIDUAL"),
    first_name: z.string().trim().min(1).max(100).nullish(),
    last_name: z.string().trim().min(1).max(100).nullish(),
    company_name: z.string().trim().min(1).max(200).nullish(),
    phone: phone.nullish(),
    whatsapp_phone: phone.nullish(),
    email: z.string().trim().email().max(200).nullish(),
    address: z.string().trim().max(300).nullish(),
    commune: z.string().trim().max(100).nullish(),
    ncc: z.string().trim().max(50).nullish(),
    rccm: z.string().trim().max(50).nullish(),
    payment_terms_days: z.number().int().min(0).max(365).optional(),
    notes: z.string().trim().max(2_000).nullish(),
    external_id: externalId.optional(),
    source: source.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "INDIVIDUAL" && !v.last_name) {
      ctx.addIssue({ code: "custom", path: ["last_name"], message: "Nom obligatoire." });
    }
    if (v.type === "COMPANY" && !v.company_name) {
      ctx.addIssue({
        code: "custom",
        path: ["company_name"],
        message: "Raison sociale obligatoire.",
      });
    }
  });
export type ApiCustomerCreate = z.infer<typeof apiCustomerCreateSchema>;

export const apiCustomerPatchSchema = z
  .object({
    first_name: z.string().trim().min(1).max(100).nullable(),
    last_name: z.string().trim().min(1).max(100),
    company_name: z.string().trim().min(1).max(200),
    phone: phone.nullable(),
    whatsapp_phone: phone.nullable(),
    email: z.string().trim().email().max(200).nullable(),
    address: z.string().trim().max(300).nullable(),
    commune: z.string().trim().max(100).nullable(),
    ncc: z.string().trim().max(50).nullable(),
    rccm: z.string().trim().max(50).nullable(),
    payment_terms_days: z.number().int().min(0).max(365),
    notes: z.string().trim().max(2_000).nullable(),
    external_id: externalId,
    source,
  })
  .partial()
  .strict();
export type ApiCustomerPatch = z.infer<typeof apiCustomerPatchSchema>;

export const apiVehicleCreateSchema = z
  .object({
    customer_id: z.string().min(1),
    plate: z.string().trim().min(2).max(20),
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    year: z.number().int().min(1950).max(2100).nullish(),
    vin: z.string().trim().max(32).nullish(),
    color: z.string().trim().max(40).nullish(),
    current_mileage: z.number().int().min(0).max(5_000_000).nullish(),
    inspection_expiry_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
      .nullish(),
    external_id: externalId.optional(),
    source: source.optional(),
  })
  .strict();
export type ApiVehicleCreate = z.infer<typeof apiVehicleCreateSchema>;

export const apiWebhookEndpointCreateSchema = z
  .object({
    url: z.string().trim().min(8).max(2_000),
    events: z.array(z.string()).min(1),
    description: z.string().trim().max(200).nullish(),
  })
  .strict();

export const apiWebhookEndpointPatchSchema = z
  .object({
    url: z.string().trim().min(8).max(2_000),
    events: z.array(z.string()).min(1),
    description: z.string().trim().max(200).nullable(),
    is_active: z.boolean(),
  })
  .partial()
  .strict();

// ───────────── Back-office (tRPC) ─────────────

export const apiKeyCreateInputSchema = z.object({
  name: z.string().trim().min(2, "Nom de la clé : 2 caractères minimum.").max(80),
  scopes: z.array(z.string()).min(1, "Choisissez au moins un droit."),
  environment: z.enum(["live", "test"]).default("live"),
  expiresAt: z.coerce.date().nullish(),
  siteIds: z.array(z.string().min(1)).default([]),
});

export const integrationIdInputSchema = z.object({ id: z.string().min(1) });

export const webhookCreateInputSchema = z.object({
  url: z.string().trim().min(8).max(2_000),
  events: z.array(z.string()).min(1, "Choisissez au moins un événement."),
  description: z.string().trim().max(200).nullish(),
});

export const webhookUpdateInputSchema = z.object({
  id: z.string().min(1),
  url: z.string().trim().min(8).max(2_000).optional(),
  events: z.array(z.string()).min(1).optional(),
  description: z.string().trim().max(200).nullish(),
  isActive: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

export const webhookDeliveriesInputSchema = z.object({
  id: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(30),
});
