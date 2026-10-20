// M16 §8 — entrées des routeurs `insurer` et `claim` (assurances et sinistres).
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const fcfa = z
  .number()
  .int("Montant en FCFA entier.")
  .min(0, "Le montant ne peut pas être négatif.")
  .max(1_000_000_000, "Montant trop élevé : vérifiez la saisie.");
const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);
const text = (max: number) => z.string().trim().max(max);

export const claimStatusSchema = z.enum([
  "OPENED",
  "EXPERT_SCHEDULED",
  "ESTIMATE_SENT",
  "APPROVED",
  "REPAIRING",
  "INVOICED",
  "PARTIALLY_PAID",
  "PAID",
  "REJECTED",
  "CANCELLED",
]);

export const claimAttachmentKindSchema = z.enum([
  "claim_report",
  "photo_damage",
  "photo_repair",
  "expert_report",
  "approval_letter",
  "registration",
  "insurance_certificate",
  "driver_license",
  "police_report",
  "invoice_supplier",
  "other",
]);

export const insurerInputSchema = z.object({
  name: z.string().trim().min(2, "Indiquez le nom de la compagnie.").max(160),
  legalName: text(200).optional(),
  ncc: text(30).optional(),
  rccm: text(60).optional(),
  address: text(300).optional(),
  phone: text(30).optional(),
  email: z.string().trim().email("Adresse email invalide.").max(200).optional().or(z.literal("")),
  claimsContactName: text(160).optional(),
  claimsPhone: text(30).optional(),
  claimsEmail: z
    .string()
    .trim()
    .email("Adresse email invalide.")
    .max(200)
    .optional()
    .or(z.literal("")),
  accountingEmail: z
    .string()
    .trim()
    .email("Adresse email invalide.")
    .max(200)
    .optional()
    .or(z.literal("")),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  laborRate: fcfa.nullable().optional(),
  partsDiscountRate: z.number().int().min(0).max(100).nullable().optional(),
  requiredDocuments: z.array(claimAttachmentKindSchema).max(11).optional(),
  followUpConfig: z
    .object({
      approval: z.array(z.number().int().min(0).max(365)).max(10).optional(),
      payment: z.array(z.number().int().min(0).max(365)).max(10).optional(),
      repeatEvery: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});
export type InsurerInput = z.infer<typeof insurerInputSchema>;

export const updateInsurerInputSchema = insurerInputSchema.partial().extend({ id });

export const insurerStatsInputSchema = z.object({ siteId: id.optional() });

export const claimListInputSchema = z.object({
  status: claimStatusSchema.optional(),
  insurerId: id.optional(),
  blockedOnly: z.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const claimIdInputSchema = z.object({ id });

export const createClaimInputSchema = z.object({
  customerId: id.optional(),
  vehicleId: id.optional(),
  insuranceCompanyId: id,
  repairOrderId: id.optional(),
  policyNumber: text(80).optional(),
  claimNumber: text(80).optional(),
  accidentDate: isoDate.optional(),
  accidentPlace: text(200).optional(),
  circumstances: text(2000).optional(),
  deductible: fcfa.optional(),
  vatPaidBy: z.enum(["INSURANCE", "CUSTOMER"]).optional(),
  notes: text(2000).optional(),
});

export const updateClaimInputSchema = z.object({
  id,
  insuranceCompanyId: id.optional(),
  policyNumber: text(80).nullable().optional(),
  claimNumber: text(80).nullable().optional(),
  accidentDate: isoDate.nullable().optional(),
  accidentPlace: text(200).nullable().optional(),
  circumstances: text(2000).nullable().optional(),
  deductible: fcfa.optional(),
  vatPaidBy: z.enum(["INSURANCE", "CUSTOMER"]).optional(),
  notes: text(2000).nullable().optional(),
  reason: text(500).optional(),
});

export const scheduleExpertInputSchema = z.object({
  id,
  expertName: z.string().trim().min(2, "Indiquez le nom de l'expert.").max(160),
  expertFirm: text(160).optional(),
  expertPhone: text(30).optional(),
  expertEmail: z
    .string()
    .trim()
    .email("Adresse email invalide.")
    .max(200)
    .optional()
    .or(z.literal("")),
  expertVisitAt: z.coerce.date(),
});

export const recordExpertVisitInputSchema = z.object({
  id,
  visitedAt: z.coerce.date(),
  reportAttachmentId: id.optional(),
});

export const sendEstimateInputSchema = z.object({
  id,
  quoteId: id.optional(),
  channel: z.enum(["email", "hand", "whatsapp"]).default("email"),
  address: text(200).optional(),
});

export const recordApprovalInputSchema = z.object({
  id,
  approvedAmount: fcfa,
  deductible: fcfa,
  depreciation: fcfa.optional(),
  approvalRef: text(120).optional(),
  approvalAttachmentId: id.optional(),
  gapHandling: z.enum(["REVISE", "CUSTOMER", "GARAGE"]).optional(),
  reason: text(500).optional(),
});

export const claimReasonInputSchema = z.object({ id, reason, attachmentId: id.optional() });

export const claimActivityInputSchema = z.object({
  id,
  type: z.enum(["call", "note", "email", "visit"]),
  body: z.string().trim().min(1, "Saisissez le contenu.").max(2000),
  nextActionAt: z.coerce.date().optional(),
});

export const claimFollowUpsInputSchema = z.object({ dueBefore: z.coerce.date().optional() });

export const sendFollowUpInputSchema = z.object({
  followUpId: id,
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]).optional(),
});

export const snoozeFollowUpInputSchema = z.object({ followUpId: id, until: z.coerce.date() });

export const uploadClaimDocumentInputSchema = z.object({
  id,
  kind: claimAttachmentKindSchema,
  mimeType: z.enum(["image/webp", "image/jpeg", "image/png", "application/pdf"]),
  /** Contenu en base64 (sans préfixe data:). */
  dataBase64: z.string().min(4).max(14_000_000),
  caption: text(160).optional(),
});
