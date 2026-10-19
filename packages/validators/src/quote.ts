// M05 §8 — entrées des routeurs `quote`, `quoteLine`, `laborOperation` et du portail devis.
import { z } from "zod";
import { inspectionResultSchema, lineTypeSchema, payerSchema } from "./repairOrder";

const id = z.string().min(1);
const fcfa = z.number().int("Montant en FCFA entier.").min(0, "Le montant ne peut pas être négatif.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);
const token = z.string().min(16).max(200);

export const quoteStatusSchema = z.enum([
  "DRAFT",
  "SENT",
  "VIEWED",
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED",
]);
export const quoteOriginSchema = z.enum([
  "REPAIR_ORDER",
  "INSPECTION",
  "STANDALONE",
  "APPOINTMENT",
  "INSURANCE",
]);
export const quoteTabSchema = z.enum(["TODO", "PENDING", "DECIDED", "EXPIRED", "ALL"]);
export const declineReasonSchema = z.enum(["TOO_EXPENSIVE", "LATER", "ELSEWHERE", "OTHER"]);
export const discountReasonSchema = z.enum([
  "LOYAL_CUSTOMER",
  "FLEET",
  "COMMERCIAL_GESTURE",
  "COMPETITION",
  "OTHER",
]);
export const decisionChannelSchema = z.enum(["phone", "in_person", "whatsapp", "insurer"]);
export const sendChannelSchema = z.enum(["WHATSAPP", "SMS", "EMAIL", "LINK_ONLY", "WA_LINK"]);

export const quoteLineInputSchema = z.object({
  type: lineTypeSchema,
  productId: id.optional(),
  laborOperationId: id.optional(),
  description: z.string().trim().min(1, "Saisissez une désignation.").max(300),
  quantity: z.number().positive("La quantité doit être positive.").max(10_000),
  unitPrice: fcfa.optional(),
  discountRate: z.number().int().min(0).max(100).optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
  payer: payerSchema.optional(),
  isOptional: z.boolean().optional(),
  priority: inspectionResultSchema.nullable().optional(),
  groupKey: z.string().trim().min(1).max(60).nullable().optional(),
  groupLabel: z.string().trim().min(1).max(120).nullable().optional(),
  requiresGroupKey: z.string().trim().min(1).max(60).nullable().optional(),
  customerExplanation: z.string().trim().max(1000).nullable().optional(),
  inspectionItemId: id.nullable().optional(),
  photoAttachmentIds: z.array(id).max(20).optional(),
  costPrice: fcfa.nullable().optional(),
  isCustomerSupplied: z.boolean().optional(),
  priceReason: z.string().trim().max(500).optional(),
});
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const quoteListInputSchema = z.object({
  tab: quoteTabSchema.default("ALL"),
  siteId: id.optional(),
  statuses: z.array(quoteStatusSchema).optional(),
  advisorId: id.optional(),
  origin: quoteOriginSchema.optional(),
  customerId: id.optional(),
  vehicleId: id.optional(),
  repairOrderId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minTotal: fcfa.optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const quoteIdInputSchema = z.object({ id });

export const newCustomerSchema = z.object({
  name: z.string().trim().min(2, "Indiquez le nom du client.").max(120),
  phone: z.string().trim().min(8, "Indiquez un numéro de téléphone.").max(30),
});

export const quoteCreateInputSchema = z
  .object({
    siteId: id.optional(),
    customerId: id.optional(),
    newCustomer: newCustomerSchema.optional(),
    vehicleId: id.optional(),
    repairOrderId: id.optional(),
    insuranceClaimId: id.optional(),
    origin: quoteOriginSchema.optional(),
    validUntil: isoDate.optional(),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(quoteLineInputSchema).max(200).optional(),
  })
  .refine((v) => v.customerId || v.newCustomer || v.repairOrderId, {
    message: "Indiquez un client.",
    path: ["customerId"],
  });

export const quoteCreateFromInspectionInputSchema = z.object({
  inspectionId: id,
  includeWatch: z.boolean().default(true),
});

export const quoteCreateFromRepairOrderInputSchema = z.object({ repairOrderId: id });

export const quoteUpdateInputSchema = z.object({
  id,
  patch: z.object({
    validUntil: isoDate.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    globalDiscountRate: z.number().int().min(0).max(100).nullable().optional(),
    globalDiscountAmount: fcfa.nullable().optional(),
    discountReason: z.string().trim().max(200).nullable().optional(),
    customerPoNumber: z.string().trim().max(60).nullable().optional(),
    recipientContactId: id.nullable().optional(),
  }),
});

export const quoteLineAddInputSchema = quoteLineInputSchema.extend({ quoteId: id });
export const quoteLineUpdateInputSchema = z.object({
  id,
  patch: quoteLineInputSchema.partial(),
});
export const quoteLineRemoveInputSchema = z.object({ id });
export const quoteLineReorderInputSchema = z.object({
  quoteId: id,
  orderedIds: z.array(id).min(1).max(200),
  groups: z
    .array(z.object({ lineId: id, groupKey: z.string().trim().min(1).max(60).nullable() }))
    .optional(),
});

export const quoteAddKitInputSchema = z.object({
  quoteId: id,
  laborOperationId: id,
  vehicleId: id.optional(),
});

export const quoteRequestDiscountApprovalInputSchema = z.object({ id, reason });
export const quoteDecideDiscountInputSchema = z.object({
  id,
  decision: z.enum(["APPROVE", "REJECT", "APPROVE_PARTIAL"]),
  maxRate: z.number().int().min(0).max(100).optional(),
});

export const quoteSendInputSchema = z.object({
  id,
  channel: sendChannelSchema.default("WHATSAPP"),
  recipient: z
    .object({
      type: z.enum(["CUSTOMER", "CONTACT", "INSURER", "CUSTOM"]).default("CUSTOMER"),
      contactId: id.optional(),
      address: z.string().trim().min(3).max(200).optional(),
    })
    .default({ type: "CUSTOMER" }),
  message: z.string().trim().max(1000).optional(),
});

export const quoteResendInputSchema = z.object({
  id,
  channel: sendChannelSchema.optional(),
});

export const quoteDecisionItemSchema = z
  .object({
    lineId: id.optional(),
    groupKey: z.string().min(1).optional(),
    accepted: z.boolean(),
    declineReason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((v) => v.lineId || v.groupKey, { message: "Ligne ou groupe requis." });

export const quoteRecordDecisionInputSchema = z.object({
  id,
  channel: decisionChannelSchema,
  decisions: z.array(quoteDecisionItemSchema).max(200),
  counterpartName: z.string().trim().max(120).optional(),
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide.")
    .optional(),
  signerName: z.string().trim().max(120).optional(),
  messageId: id.optional(),
  attachmentId: id.optional(),
  approvedAmount: fcfa.optional(),
  sendWrittenConfirmation: z.boolean().default(true),
  amendment: z.boolean().optional(),
  overrideExpiredReason: reason.optional(),
  declineReason: declineReasonSchema.optional(),
});

export const quoteCreateVersionInputSchema = z.object({
  id,
  refreshPrices: z.boolean().optional(),
});

export const quoteConvertToRepairOrderInputSchema = z.object({
  id,
  siteId: id.optional(),
});

export const quoteRequestDepositInputSchema = z.object({
  id,
  amount: fcfa.optional(),
});

export const quoteDeleteInputSchema = z.object({ id, reason });

export const quoteStatsInputSchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  siteId: id.optional(),
  advisorId: id.optional(),
});

export const quoteCatalogInputSchema = z.object({
  q: z.string().trim().max(60).default(""),
  siteId: id.optional(),
});

// ───────────── Catalogue MO (RG-M05-05) ─────────────

export const laborRateTypeSchema = z.enum(["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"]);

export const laborDefaultPartSchema = z
  .object({
    productId: id.optional(),
    category: z.string().trim().min(1).max(60).optional(),
    quantity: z.number().positive().max(1000).default(1),
  })
  .refine((v) => v.productId || v.category, { message: "Produit ou catégorie requis." });

export const laborVehicleOverrideSchema = z.object({
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60).optional(),
  yearFrom: z.number().int().min(1950).max(2100).optional(),
  yearTo: z.number().int().min(1950).max(2100).optional(),
  standardHours: z.number().positive().max(200),
});

export const laborOperationInputSchema = z.object({
  code: z.string().trim().min(1, "Indiquez un code.").max(30).toUpperCase(),
  name: z.string().trim().min(2, "Indiquez un nom.").max(160),
  category: z.string().trim().max(60).nullable().optional(),
  standardHours: z.number().min(0).max(200),
  rateType: laborRateTypeSchema.default("STANDARD"),
  fixedPrice: fcfa.nullable().optional(),
  customerDescription: z.string().trim().max(1000).nullable().optional(),
  defaultParts: z.array(laborDefaultPartSchema).max(30).optional(),
  vehicleOverrides: z.array(laborVehicleOverrideSchema).max(50).optional(),
  isServiceOperation: z.boolean().optional(),
});
export type LaborOperationInput = z.infer<typeof laborOperationInputSchema>;

export const laborOperationListInputSchema = z.object({
  q: z.string().trim().max(60).optional(),
  includeArchived: z.boolean().optional(),
});
export const laborOperationUpdateInputSchema = z.object({
  id,
  patch: laborOperationInputSchema.partial(),
});
export const laborOperationIdInputSchema = z.object({ id });
export const laborOperationImportInputSchema = z.object({
  rows: z.array(laborOperationInputSchema).min(1).max(500),
});

// ───────────── Paramètres devis (§6) ─────────────

export const discountCapSchema = z.object({
  line: z.number().int().min(0).max(100),
  global: z.number().int().min(0).max(100),
});

export const quoteSettingsInputSchema = z.object({
  validityDays: z.number().int().min(1).max(365).optional(),
  validityDaysCompany: z.number().int().min(1).max(365).optional(),
  requireSignature: z.boolean().optional(),
  discountCaps: z
    .object({
      OWNER: discountCapSchema.optional(),
      MANAGER: discountCapSchema.optional(),
      ADVISOR: discountCapSchema.optional(),
      CASHIER: discountCapSchema.optional(),
    })
    .optional(),
  depositRule: z
    .object({ thresholdTtc: fcfa, rate: z.number().int().min(1).max(100) })
    .nullable()
    .optional(),
  followupWhenVehicleOnSite: z.string().trim().max(10).optional(),
  showLinePricesToCustomer: z.boolean().optional(),
  termsText: z.string().trim().max(2000).optional(),
});
export type QuoteSettingsInput = z.infer<typeof quoteSettingsInputSchema>;

// ───────────── Portail public (§8) ─────────────

export const portalQuoteTokenInputSchema = z.object({ token });

export const portalQuoteDecideInputSchema = z.object({
  token,
  decisions: z.array(z.object({ groupKey: z.string().min(1), accepted: z.boolean() })).max(200),
  signerName: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide.")
    .optional(),
  accepted: z.boolean().optional(),
  declineReason: declineReasonSchema.optional(),
  declineComment: z.string().trim().max(500).optional(),
  contentHash: z.string().min(8).max(128),
});

export const portalQuoteAskInputSchema = z.object({
  token,
  message: z.string().trim().min(2).max(1000).optional(),
  callback: z.boolean().optional(),
});
