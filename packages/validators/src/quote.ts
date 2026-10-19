// M05 §8 — entrées des routeurs `quote`, `quoteLine`, `laborOperation` et du portail devis.
import { z } from "zod";
import { inspectionResultSchema, lineTypeSchema, payerSchema } from "./repairOrder";

const id = z.string().min(1);
const fcfa = z
  .number()
  .int("Montant en FCFA entier.")
  .min(0, "Le montant ne peut pas être négatif.");
const rate = z.number().int().min(0, "Taux invalide.").max(100, "Taux invalide.");
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
export const quoteListTabSchema = z.enum(["todo", "waiting", "decided", "expired", "all"]);

export const quoteLineInputSchema = z.object({
  type: lineTypeSchema,
  productId: id.optional(),
  laborOperationId: id.optional(),
  description: z.string().trim().min(1, "Indiquez la désignation.").max(300),
  quantity: z.number().positive("Quantité invalide.").max(10_000),
  unitPrice: fcfa.optional(),
  discountRate: rate.optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
  payer: payerSchema.optional(),
  isOptional: z.boolean().optional(),
  priority: inspectionResultSchema.nullable().optional(),
  groupKey: z.string().trim().max(80).nullable().optional(),
  groupLabel: z.string().trim().max(160).nullable().optional(),
  requiresGroupKey: z.string().trim().max(80).nullable().optional(),
  customerExplanation: z.string().trim().max(1000).nullable().optional(),
  isCustomerSupplied: z.boolean().optional(),
  costPrice: fcfa.nullable().optional(),
  photoAttachmentIds: z.array(id).max(10).optional(),
});
export type QuoteLineInput = z.infer<typeof quoteLineInputSchema>;

export const quoteListInputSchema = z
  .object({
    tab: quoteListTabSchema.default("all"),
    siteId: id.optional(),
    statuses: z.array(quoteStatusSchema).optional(),
    advisorId: id.optional(),
    origin: quoteOriginSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    minTotal: fcfa.optional(),
    q: z.string().trim().max(100).optional(),
    cursor: id.optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .default({});

export const quoteIdInputSchema = z.object({ id });

export const createQuoteInputSchema = z
  .object({
    siteId: id.optional(),
    customerId: id.optional(),
    newCustomer: z
      .object({
        name: z.string().trim().min(2, "Indiquez le nom du client.").max(160),
        phone: z.string().trim().min(8, "Indiquez le téléphone.").max(30),
      })
      .optional(),
    vehicleId: id.optional(),
    repairOrderId: id.optional(),
    origin: quoteOriginSchema.default("STANDALONE"),
    validUntil: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
    lines: z.array(quoteLineInputSchema).max(200).optional(),
  })
  .refine((v) => v.customerId || v.newCustomer || v.repairOrderId, {
    message: "Choisissez un client ou créez-le.",
    path: ["customerId"],
  });

export const createFromInspectionInputSchema = z.object({
  inspectionId: id,
  includeWatch: z.boolean().default(true),
});
export const createFromRepairOrderPendingInputSchema = z.object({ repairOrderId: id });

export const updateQuoteInputSchema = z.object({
  id,
  patch: z.object({
    validUntil: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    globalDiscountRate: rate.nullable().optional(),
    globalDiscountAmount: fcfa.nullable().optional(),
    discountReason: z.string().trim().max(200).nullable().optional(),
    vehicleId: id.nullable().optional(),
    customerPoNumber: z.string().trim().max(60).nullable().optional(),
  }),
});

export const addQuoteLineInputSchema = quoteLineInputSchema.extend({
  quoteId: id,
  priceReason: z.string().trim().max(500).optional(),
});
export const updateQuoteLineInputSchema = z.object({
  id,
  patch: quoteLineInputSchema.partial().omit({ type: true }),
  priceReason: z.string().trim().max(500).optional(),
});
export const removeQuoteLineInputSchema = z.object({ id });
export const reorderQuoteLinesInputSchema = z.object({
  quoteId: id,
  orderedIds: z.array(id).min(1).max(200),
  groups: z
    .array(
      z.object({
        lineId: id,
        groupKey: z.string().max(80).nullable(),
        groupLabel: z.string().max(160).nullable(),
      }),
    )
    .optional(),
});
export const addKitInputSchema = z.object({
  quoteId: id,
  laborOperationId: id,
  vehicleId: id.optional(),
});

export const requestDiscountApprovalInputSchema = z.object({
  id,
  reason: z.string().trim().max(500),
});
export const decideDiscountInputSchema = z.object({
  id,
  decision: z.enum(["APPROVE", "REJECT", "APPROVE_PARTIAL"]),
  maxRate: rate.optional(),
});

export const quotePdfVariantSchema = z.enum(["customer", "insurer", "signed"]);

export const sendQuoteInputSchema = z.object({
  id,
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL", "LINK_ONLY", "WA_LINK"]),
  recipient: z
    .object({
      type: z.enum(["CUSTOMER", "CONTACT", "INSURER", "CUSTOM"]),
      contactId: id.optional(),
      address: z.string().trim().max(200).optional(),
    })
    .default({ type: "CUSTOMER" }),
  message: z.string().trim().max(2000).optional(),
});
export const resendQuoteInputSchema = z.object({
  id,
  channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]).optional(),
});

export const decisionChannelSchema = z.enum(["phone", "in_person", "whatsapp", "insurer"]);
export const lineDecisionSchema = z
  .object({
    lineId: id.optional(),
    groupKey: z.string().max(80).optional(),
    accepted: z.boolean(),
    declineReason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((d) => d.lineId || d.groupKey, { message: "Ligne ou groupe requis." });

export const recordDecisionInputSchema = z.object({
  id,
  channel: decisionChannelSchema,
  decisions: z.array(lineDecisionSchema).min(1).max(200),
  counterpartName: z.string().trim().max(160).optional(),
  decidedAtTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  signature: z
    .object({
      dataUrl: z.string().regex(/^data:image\/(png|webp|jpeg);base64,/, "Signature invalide."),
      signerName: z.string().trim().min(1).max(120),
    })
    .optional(),
  messageId: id.optional(),
  attachmentId: id.optional(),
  sendWrittenConfirmation: z.boolean().default(true),
  amendment: z.boolean().optional(),
  overrideExpiredReason: reason.optional(),
  insurerApprovedAmount: fcfa.optional(),
  declineReason: z.string().trim().max(200).optional(),
});

export const createVersionInputSchema = z.object({ id, refreshPrices: z.boolean().optional() });
export const convertToRepairOrderInputSchema = z.object({ id, siteId: id.optional() });
export const requestDepositInputSchema = z.object({ id, amount: fcfa.optional() });
export const deleteQuoteInputSchema = z.object({ id, reason });
export const quoteStatsInputSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  siteId: id.optional(),
  advisorId: id.optional(),
});
export const quoteCatalogInputSchema = z.object({
  q: z.string().trim().max(100).default(""),
  quoteId: id.optional(),
});

export const quoteSettingsInputSchema = z.object({
  validityDays: z.number().int().min(1).max(365).optional(),
  validityDaysCompany: z.number().int().min(1).max(365).optional(),
  requireSignature: z.boolean().optional(),
  discountCaps: z.record(z.string(), z.object({ line: rate, global: rate })).optional(),
  depositRule: z.object({ thresholdTtc: fcfa, rate: rate }).nullable().optional(),
  followupWhenVehicleOnSite: z.string().trim().max(10).optional(),
  showLinePricesToCustomer: z.boolean().optional(),
  termsText: z.string().trim().max(1000).optional(),
});

// ───────────── Catalogue MO ─────────────

export const laborRateTypeSchema = z.enum(["STANDARD", "DIAGNOSTIC", "BODYWORK", "ELECTRICAL"]);
export const laborOperationInputSchema = z.object({
  code: z.string().trim().min(1, "Indiquez le code.").max(40),
  name: z.string().trim().min(2, "Indiquez le nom.").max(160),
  category: z.string().trim().max(80).nullable().optional(),
  standardHours: z.number().min(0).max(200),
  rateType: laborRateTypeSchema.default("STANDARD"),
  fixedPrice: fcfa.nullable().optional(),
  customerDescription: z.string().trim().max(1000).nullable().optional(),
  isServiceOperation: z.boolean().optional(),
  defaultParts: z
    .array(
      z.object({
        productId: id.optional(),
        category: z.string().max(80).optional(),
        quantity: z.number().positive().max(1000),
      }),
    )
    .max(30)
    .optional(),
  vehicleOverrides: z
    .array(
      z.object({
        make: z.string().trim().min(1).max(60),
        model: z.string().trim().max(60).nullable().optional(),
        yearFrom: z.number().int().nullable().optional(),
        yearTo: z.number().int().nullable().optional(),
        standardHours: z.number().min(0).max(200),
      }),
    )
    .max(50)
    .optional(),
});
export const laborOperationListInputSchema = z
  .object({ q: z.string().trim().max(100).optional(), includeArchived: z.boolean().optional() })
  .default({});
export const updateLaborOperationInputSchema = z.object({
  id,
  patch: laborOperationInputSchema.partial(),
});
export const archiveLaborOperationInputSchema = z.object({
  id,
  archived: z.boolean().default(true),
});
export const importLaborOperationsInputSchema = z.object({ csv: z.string().min(1).max(500_000) });

// ───────────── Portail public ─────────────

export const portalQuoteGetInputSchema = z.object({ token });
export const portalQuoteDecideInputSchema = z.object({
  token,
  quoteId: id,
  decisions: z
    .array(
      z.object({
        groupKey: z.string().min(1).max(80),
        accepted: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  signerName: z.string().trim().min(2, "Indiquez votre nom.").max(120),
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/png;base64,/, "Signature invalide.")
    .max(280_000, "Signature trop lourde.")
    .optional(),
  acceptTerms: z.boolean().optional(),
  declineReason: z.string().trim().max(200).optional(),
  contentHash: z.string().min(16).max(128),
});
export const portalQuoteAskInputSchema = z
  .object({
    token,
    message: z.string().trim().max(1000).optional(),
    callback: z.boolean().optional(),
    refresh: z.boolean().optional(),
  })
  .refine((v) => v.message || v.callback || v.refresh, {
    message: "Écrivez votre question.",
    path: ["message"],
  });
