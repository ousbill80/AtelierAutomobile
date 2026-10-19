// M08 §FNE / M15 RG-M15-18 — entrées du routeur `fne` : configuration (mode, adaptateur,
// identifiants DGI chiffrés côté serveur), test, réessai et saisie manuelle.
import { z } from "zod";

const id = z.string().min(1);

export const fneModeSchema = z.enum(["api", "manual", "disabled"]);
export const fneProviderSchema = z.enum(["dgi_api", "fake"]);

export const fneConfigUpdateInputSchema = z.object({
  mode: fneModeSchema,
  provider: fneProviderSchema.default("dgi_api"),
  establishmentId: z.string().trim().max(64).nullish(),
  pointOfSale: z.string().trim().max(64).nullish(),
  /** Absent : les identifiants déjà enregistrés sont conservés (jamais renvoyés au navigateur). */
  credentials: z
    .object({
      baseUrl: z.string().trim().url("Adresse du service DGI invalide (https://…)."),
      apiKey: z.string().trim().min(8, "Clé d'accès DGI trop courte.").max(500),
    })
    .optional(),
  reason: z.string().trim().max(500).optional(),
});
export type FneConfigUpdateInput = z.infer<typeof fneConfigUpdateInputSchema>;

export const fneInvoiceInputSchema = z.object({ invoiceId: id });

/** Image du QR code importée (PNG/JPEG en data URL, 300 Ko au plus). */
const qrImageSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, "Image du QR code : PNG ou JPEG.")
  .max(410_000, "Image du QR code trop lourde (300 Ko au plus).");

export const fneSetManualInputSchema = z.object({
  invoiceId: id,
  fneNumber: z.string().trim().min(3, "Saisissez le numéro FNE.").max(64),
  qrCode: z.string().trim().max(2_000).optional(),
  qrImage: qrImageSchema.optional(),
});
export type FneSetManualInput = z.infer<typeof fneSetManualInputSchema>;
