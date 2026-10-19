// M08 §8 — entrées des routeurs `invoice`, `payment` (encaissement comptoir), `refund`, `cash`
// et `accounting` (étape 4.1 : hors FNE et liens de paiement).
import { z } from "zod";
import { paymentMethodSchema } from "./receivables";
import { lineTypeSchema } from "./repairOrder";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const positive = z
  .number()
  .int("Montant en FCFA entier.")
  .positive("Le montant doit être positif.");
const nonNegative = z
  .number()
  .int("Montant en FCFA entier.")
  .min(0, "Le montant ne peut pas être négatif.");
const reason = z.string().trim().min(3, "Indiquez un motif (3 caractères minimum).").max(500);

export const invoiceStatusSchema = z.enum([
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
  "WRITTEN_OFF",
  "DISPUTED",
]);

export const invoiceLineInputSchema = z.object({
  type: lineTypeSchema,
  productId: id.optional(),
  laborOperationId: id.optional(),
  description: z.string().trim().min(1, "Indiquez la désignation.").max(300),
  quantity: z.number().positive("Quantité invalide.").max(10_000),
  unitPrice: nonNegative.optional(),
  discountRate: z.number().int().min(0, "Remise invalide.").max(100, "Remise invalide.").optional(),
  vatRate: z.number().int().min(0).max(100).optional(),
});
export type InvoiceLineFormInput = z.infer<typeof invoiceLineInputSchema>;

export const invoiceIdInputSchema = z.object({ id });

export const createFromRepairOrderInputSchema = z.object({ repairOrderId: id });

export const createFromQuoteInputSchema = z.object({ quoteId: id });

export const createDirectInvoiceInputSchema = z.object({
  siteId: id.optional(),
  /** Absent : client « Comptoir » générique si `settings.billing.allowWalkIn`. */
  customerId: id.optional(),
  vehicleId: id.optional(),
  lines: z.array(invoiceLineInputSchema).min(1, "Ajoutez au moins une ligne.").max(200),
  notes: z.string().trim().max(1000).optional(),
  /** RG-M07-13 : motif d'un prix sous le minimum (permission `invoice:price_below_min`). */
  priceReason: z.string().trim().max(300).optional(),
});

export const createDepositInputSchema = z.object({
  customerId: id,
  quoteId: id.optional(),
  repairOrderId: id.optional(),
  amountTtc: positive,
});

export const updateInvoiceInputSchema = z.object({
  id,
  lines: z.array(invoiceLineInputSchema).min(1, "Ajoutez au moins une ligne.").max(200).optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  priceReason: z.string().trim().max(300).optional(),
});

export const previewInvoiceInputSchema = z.object({
  lines: z.array(invoiceLineInputSchema).max(200),
});

export const issueInvoiceInputSchema = z.object({
  id,
  applyDepositIds: z.array(id).max(20).optional(),
});

export const creditNoteInputSchema = z.object({
  invoiceId: id,
  lines: z.union([
    z.literal("FULL"),
    z
      .array(z.object({ invoiceLineId: id, quantity: z.number().positive().max(10_000) }))
      .min(1, "Sélectionnez au moins une ligne."),
  ]),
  reason,
});

export const invoiceListInputSchema = z.object({
  status: invoiceStatusSchema.optional(),
  /** `open` : émises non soldées ; `fne_pending` : non certifiées (RG-M08-16). */
  view: z.enum(["all", "drafts", "open", "paid", "fne_pending", "credit_notes"]).default("all"),
  q: z.string().trim().max(100).optional(),
  customerId: id.optional(),
  repairOrderId: id.optional(),
  siteId: id.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const updateDueDateInputSchema = z.object({ id, dueDate: isoDate, reason });

export const createPaymentInputSchema = z.object({
  siteId: id.optional(),
  customerId: id,
  method: paymentMethodSchema,
  amount: positive,
  reference: z.string().trim().max(100).optional(),
  payerPhone: z.string().trim().max(30).optional(),
  /** Facture depuis laquelle on encaisse (RG-M08-19 : soldée en premier). */
  currentInvoiceId: id.optional(),
  allocations: z
    .array(z.object({ invoiceId: id, amount: positive }))
    .max(50)
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

export const suggestAllocationInputSchema = z.object({
  customerId: id,
  amount: positive,
  currentInvoiceId: id.optional(),
});

export const allocatePaymentInputSchema = z
  .object({
    paymentId: id.optional(),
    creditId: id.optional(),
    allocations: z
      .array(z.object({ invoiceId: id, amount: positive }))
      .min(1)
      .max(50),
  })
  .refine((v) => Boolean(v.paymentId) !== Boolean(v.creditId), {
    message: "Indiquez soit un paiement, soit un crédit client.",
  });

export const paymentReasonInputSchema = z.object({ id, reason });
export const paymentIdInputSchema = z.object({ id });

export const paymentListInputSchema = z.object({
  method: paymentMethodSchema.optional(),
  status: z.enum(["PENDING", "CONFIRMED", "FAILED", "REFUNDED"]).optional(),
  unallocatedOnly: z.boolean().optional(),
  siteId: id.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const createRefundInputSchema = z
  .object({
    paymentId: id.optional(),
    creditId: id.optional(),
    amount: positive,
    method: paymentMethodSchema,
    reference: z.string().trim().max(100).optional(),
    reason,
  })
  .refine((v) => Boolean(v.paymentId) !== Boolean(v.creditId), {
    message: "Indiquez soit un paiement, soit un crédit client.",
  });

export const cashSiteInputSchema = z.object({ siteId: id.optional() });

export const openCashInputSchema = z.object({ siteId: id.optional(), openingFloat: nonNegative });

export const closeCashInputSchema = z.object({
  id,
  countedCash: nonNegative.optional(),
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const reviewCashInputSchema = z.object({ id, comment: reason });

export const cashExpenseInputSchema = z.object({
  sessionId: id,
  category: z.string().trim().min(1).max(60),
  amount: positive,
  description: z.string().trim().min(1, "Décrivez la dépense.").max(300),
  attachmentId: id.optional(),
});

export const cashDropInputSchema = z.object({
  sessionId: id,
  amount: positive,
  destination: z.enum(["safe", "bank"]),
  reference: z.string().trim().max(100).optional(),
});

export const cashSessionsInputSchema = z.object({
  siteId: id.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const accountingExportInputSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    journal: z.enum(["VT", "EN", "CA", "ALL"]).default("ALL"),
    format: z.enum(["syscohada_csv", "sales_csv"]).default("syscohada_csv"),
  })
  .refine((v) => v.from <= v.to, { message: "La date de début doit précéder la date de fin." });
export type AccountingExportInput = z.infer<typeof accountingExportInputSchema>;
