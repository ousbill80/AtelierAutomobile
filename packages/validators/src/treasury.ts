// M18 — trésorerie : entrées des procédures `treasury.*` (montants entiers FCFA, dates métier).
import { z } from "zod";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
const positive = z
  .number({ message: "Montant requis." })
  .int("Montant entier en FCFA attendu.")
  .positive("Le montant doit être supérieur à 0.");
const money = z.number({ message: "Montant requis." }).int("Montant entier en FCFA attendu.");
const optionalText = (max: number) => z.string().trim().max(max).optional();
const ledgerAccount = z
  .string()
  .trim()
  .regex(/^\d{2,8}$/, "Compte comptable : chiffres uniquement (ex. 521).")
  .optional();

export const treasuryAccountTypeSchema = z.enum([
  "CASH_REGISTER",
  "SAFE",
  "BANK",
  "MOBILE_MONEY",
  "OTHER",
]);

export const routableMethodSchema = z.enum([
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "INSURANCE",
  "OTHER",
]);

export const createTreasuryAccountInputSchema = z.object({
  name: z.string().trim().min(1, "Donnez un nom au compte.").max(60),
  type: treasuryAccountTypeSchema,
  siteId: id.optional(),
  paymentMethods: z.array(routableMethodSchema).max(9).default([]),
  bankName: optionalText(80),
  accountRef: optionalText(60),
  ledgerAccount,
  openingBalance: money.default(0),
  openingDate: isoDate,
});

export const updateTreasuryAccountInputSchema = z.object({
  id,
  name: z.string().trim().min(1, "Donnez un nom au compte.").max(60),
  paymentMethods: z.array(routableMethodSchema).max(9),
  bankName: optionalText(80),
  accountRef: optionalText(60),
  ledgerAccount,
});

export const treasuryIdInputSchema = z.object({ id });

export const treasuryJournalInputSchema = z.object({
  accountId: id.optional(),
  /** Sens (entrées / sorties) — pas `direction`, réservé par les requêtes infinies tRPC. */
  flow: z.enum(["IN", "OUT"]).optional(),
  kind: z
    .enum([
      "PAYMENT",
      "PAYMENT_REVERSAL",
      "REFUND",
      "EXPENSE",
      "CASH_DROP",
      "CASH_VARIANCE",
      "TRANSFER",
      "INCOME",
      "ADJUSTMENT",
    ])
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});

export const treasuryTransferInputSchema = z.object({
  fromAccountId: id,
  toAccountId: id,
  amount: positive,
  date: isoDate.optional(),
  reference: optionalText(80),
  notes: optionalText(300),
});

export const treasuryMovementInputSchema = z.object({
  accountId: id,
  kind: z.enum(["INCOME", "ADJUSTMENT"]),
  direction: z.enum(["IN", "OUT"]),
  amount: positive,
  category: z.string().trim().min(1, "Choisissez une catégorie.").max(60),
  label: z.string().trim().min(3, "Décrivez le mouvement (3 caractères minimum).").max(200),
  date: isoDate.optional(),
  reference: optionalText(80),
});

export const treasuryReverseInputSchema = z.object({
  id,
  reason: z.string().trim().min(3, "Indiquez le motif (3 caractères minimum).").max(300),
});

export const treasuryExpenseInputSchema = z.object({
  accountId: id,
  category: z.string().trim().min(1, "Choisissez une catégorie.").max(60),
  amount: positive,
  description: z.string().trim().min(1, "Décrivez la dépense.").max(300),
  date: isoDate.optional(),
});

export const treasuryReconcileInputSchema = z.object({
  accountId: id,
  statementDate: isoDate,
  statementBalance: money,
  notes: optionalText(300),
  postAdjustment: z.boolean().default(false),
});

export const treasuryAccountDetailInputSchema = z.object({ id });

export const treasuryReportInputSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    accountId: id.optional(),
    groupBy: z.enum(["day", "week", "month"]).default("day"),
  })
  .refine((v) => v.from <= v.to, "La date de début doit précéder la date de fin.")
  .refine(
    (v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 731,
    "Période limitée à deux ans.",
  );

export type TreasuryReportInput = z.infer<typeof treasuryReportInputSchema>;
