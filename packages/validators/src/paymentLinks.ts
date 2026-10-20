// M08 §8 `paymentLink.*`, `invoice.send` (étape 4.3), M15 `paymentProviders.*`, M14
// `portal.invoice.*`.
import { z } from "zod";

const id = z.string().min(1);
const token = z.string().min(16).max(200);

export const onlinePaymentMethodSchema = z.enum([
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CARD",
]);

export const sendChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL"]);

export const createPaymentLinkInputSchema = z.object({
  invoiceId: id,
  /** Défaut : le solde ; modifiable vers le bas (RG-M08-23). */
  amount: z.number().int("Montant en FCFA entier.").positive().optional(),
  expiresInHours: z.number().int().min(1).max(720).optional(),
  /** Envoi immédiat du lien (WhatsApp / SMS / email). */
  send: sendChannelSchema.optional(),
});

export const paymentLinkIdInputSchema = z.object({ id });
export const paymentLinkListInputSchema = z.object({ invoiceId: id });

export const sendInvoiceInputSchema = z.object({
  id,
  channel: sendChannelSchema,
  /** Joindre un lien de paiement du solde (créé ou réutilisé). */
  includePaymentLink: z.boolean().default(true),
});

export const paymentProviderNameSchema = z.enum(["cinetpay", "wave", "fake"]);

export const upsertPaymentProviderInputSchema = z.object({
  provider: paymentProviderNameSchema,
  methods: z.array(onlinePaymentMethodSchema).min(1, "Choisissez au moins un moyen de paiement."),
  /** Champs secrets ; un champ vide conserve la valeur enregistrée. */
  credentials: z.record(z.string().max(500)).default({}),
  isActive: z.boolean().default(false),
});

export const paymentProviderInputSchema = z.object({ provider: paymentProviderNameSchema });

export const setPaymentProviderActiveInputSchema = z.object({
  provider: paymentProviderNameSchema,
  isActive: z.boolean(),
});

const merchantNumber = z.string().trim().max(30).nullable();
export const merchantNumbersInputSchema = z.object({
  wave: merchantNumber,
  orangeMoney: merchantNumber,
  mtn: merchantNumber,
  moov: merchantNumber,
});

export const portalInvoiceTokenInputSchema = z.object({ token });
export const portalInvoicePayInputSchema = z.object({
  token,
  method: onlinePaymentMethodSchema,
});
