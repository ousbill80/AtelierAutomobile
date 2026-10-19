// M09 §8 — entrées du routeur `collections` (+ enregistrement de paiement manuel, M08 minimal).
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const fcfa = z.number().int("Montant en FCFA entier.").positive("Le montant doit être positif.");

export const ageBucketSchema = z.enum(["notDue", "b0_30", "b31_60", "b61_90", "b90p"]);
export const collectionTabSchema = z.enum([
  "ALL",
  "TO_HANDLE",
  "PROMISES",
  "DISPUTES",
  "WRITTEN_OFF",
]);

export const agingSummaryInputSchema = z.object({
  asOf: isoDate.optional(),
  siteId: id.optional(),
  customerType: z.enum(["INDIVIDUAL", "COMPANY"]).optional(),
});

export const listCasesInputSchema = z.object({
  tab: collectionTabSchema.default("ALL"),
  bucket: ageBucketSchema.optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const listInvoicesInputSchema = z.object({
  bucket: ageBucketSchema.optional(),
  customerId: id.optional(),
  status: z
    .enum(["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED", "WRITTEN_OFF", "PAID"])
    .optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const caseIdInputSchema = z.object({ caseId: id });

export const addPromiseInputSchema = z.object({
  caseId: id,
  installments: z
    .array(z.object({ amount: fcfa, date: isoDate }))
    .min(1)
    .max(12),
  channel: z.enum(["phone", "whatsapp", "in_person", "email"]),
  note: z.string().trim().max(500).optional(),
});

export const cancelPromiseInputSchema = z.object({
  promiseId: id,
  reason: z.string().trim().min(3, "Motif obligatoire.").max(300),
});

export const logCallInputSchema = z.object({
  caseId: id,
  outcome: z.enum(["REACHED", "NO_ANSWER", "WRONG_NUMBER", "CALLBACK"]),
  note: z.string().trim().max(1000).optional(),
  callbackAt: z.coerce.date().optional(),
});

export const addNoteInputSchema = z.object({
  caseId: id,
  body: z.string().trim().min(1, "La note est vide.").max(2000),
  type: z.enum(["note", "visit"]).default("note"),
});

export const openDisputeInputSchema = z.object({
  caseId: id,
  invoiceIds: z.array(id).min(1, "Sélectionnez au moins une facture."),
  reason: z.string().trim().min(3, "Motif obligatoire.").max(500),
  disputedAmount: fcfa.optional(),
});

export const resolveDisputeInputSchema = z.object({
  caseId: id,
  resolution: z.enum(["PAY", "CREDIT_NOTE", "WRITE_OFF"]),
  note: z.string().trim().min(3, "Note obligatoire.").max(1000),
});

export const pauseCaseInputSchema = z.object({
  caseId: id,
  until: isoDate,
  reason: z.string().trim().min(3, "Motif obligatoire.").max(300),
});

export const escalateCaseInputSchema = z.object({
  caseId: id,
  note: z.string().trim().max(500).optional(),
});
export const assignCaseInputSchema = z.object({ caseId: id, membershipId: id.nullable() });

export const writeOffInputSchema = z.object({
  invoiceIds: z.array(id).min(1),
  reason: z.string().trim().min(3, "Motif obligatoire.").max(500),
  confirmAmount: z.number().int().optional(),
});

export const reverseWriteOffInputSchema = z.object({
  invoiceId: id,
  reason: z.string().trim().min(3, "Motif obligatoire.").max(500),
});

export const creditCheckInputSchema = z.object({
  customerId: id,
  additionalAmount: z.number().int().min(0).optional(),
});

export const setCreditLimitInputSchema = z.object({
  customerId: id,
  creditLimit: z.number().int().min(0).nullable(),
  paymentTermsDays: z.number().int().min(0).max(180).optional(),
  creditHold: z.boolean().optional(),
});

export const statementInputSchema = z.object({ customerId: id, from: isoDate, to: isoDate });

export const paymentMethodSchema = z.enum([
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "BANK_TRANSFER",
  "CHEQUE",
  "CARD",
  "OTHER",
]);

export const recordPaymentInputSchema = z.object({
  customerId: id,
  amount: fcfa,
  method: paymentMethodSchema,
  receivedAt: isoDate,
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  allocations: z.array(z.object({ invoiceId: id, amount: fcfa })).optional(),
});
