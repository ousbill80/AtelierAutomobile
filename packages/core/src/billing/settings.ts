// M08 §14 — paramètres de facturation et de caisse lus dans `Organization.settings` (M15).
import type { VatRounding } from "../money/line";

export const PAYMENT_METHODS = [
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "INSURANCE",
  "OTHER",
] as const;
export type PaymentMethodLike = (typeof PAYMENT_METHODS)[number];

export const MOBILE_MONEY_METHODS: readonly PaymentMethodLike[] = [
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
];

/** RG-M08-30 — catégories de dépenses de caisse par défaut. */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "Carburant",
  "Transport",
  "Achat petite pièce",
  "Restauration",
  "Divers",
] as const;

/** RG-M08-31 — plan de comptes SYSCOHADA par défaut (modifiable dans M15). */
export interface AccountingAccounts {
  customers: string;
  parts: string;
  services: string;
  vat: string;
  cash: string;
  bank: string;
  mobileMoney: Record<"WAVE" | "ORANGE_MONEY" | "MTN_MOMO" | "MOOV_MONEY", string>;
  other: string;
  expenses: Record<string, string>;
  defaultExpense: string;
}

export const DEFAULT_ACCOUNTS: AccountingAccounts = {
  customers: "411",
  parts: "701",
  services: "706",
  vat: "4431",
  cash: "571",
  bank: "521",
  mobileMoney: { WAVE: "585", ORANGE_MONEY: "585", MTN_MOMO: "585", MOOV_MONEY: "585" },
  other: "471",
  expenses: {
    Carburant: "6053",
    Transport: "618",
    "Achat petite pièce": "6022",
    Restauration: "638",
    Divers: "658",
  },
  defaultExpense: "658",
};

export interface BillingSettings {
  vatRounding: VatRounding;
  allowWalkIn: boolean;
  blockSendUntilCertified: boolean;
  passFeesToCustomer: boolean;
  varianceAlert: number;
  expenseApproval: number;
  oneSessionPerSite: boolean;
  expenseCategories: string[];
  accounts: AccountingAccounts;
  /** RG-M15-17 : numéros marchands affichés quand aucun fournisseur de paiement n'est actif. */
  merchantNumbers: MerchantNumbers;
}

export interface MerchantNumbers {
  wave: string | null;
  orangeMoney: string | null;
  mtn: string | null;
  moov: string | null;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  vatRounding: "line",
  allowWalkIn: false,
  blockSendUntilCertified: false,
  passFeesToCustomer: false,
  varianceAlert: 5_000,
  expenseApproval: 25_000,
  oneSessionPerSite: true,
  expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
  accounts: DEFAULT_ACCOUNTS,
  merchantNumbers: { wave: null, orangeMoney: null, mtn: null, moov: null },
};

type Raw = Record<string, unknown>;

function obj(value: unknown): Raw {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
}

function int(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Lit `settings.billing`, `settings.fne`, `settings.payments`, `settings.cash`, `settings.accounting`. */
export function billingSettingsFrom(settings: unknown): BillingSettings {
  const root = obj(settings);
  const billing = obj(root.billing);
  const fne = obj(root.fne);
  const payments = obj(root.payments);
  const cash = obj(root.cash);
  const accounting = obj(root.accounting);
  const accounts = obj(accounting.accounts);
  const categories = Array.isArray(cash.expenseCategories)
    ? cash.expenseCategories.filter((c): c is string => typeof c === "string" && c.trim() !== "")
    : [];
  const str = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  return {
    vatRounding: billing.vatRounding === "total" ? "total" : "line",
    allowWalkIn: bool(billing.allowWalkIn, DEFAULT_BILLING_SETTINGS.allowWalkIn),
    blockSendUntilCertified: bool(fne.blockSendUntilCertified, false),
    passFeesToCustomer: bool(payments.passFeesToCustomer, false),
    varianceAlert: int(cash.varianceAlert, DEFAULT_BILLING_SETTINGS.varianceAlert),
    expenseApproval: int(cash.expenseApproval, DEFAULT_BILLING_SETTINGS.expenseApproval),
    oneSessionPerSite: bool(cash.oneSessionPerSite, true),
    expenseCategories: categories.length > 0 ? categories : [...DEFAULT_EXPENSE_CATEGORIES],
    accounts: {
      customers: str(accounts.customers, DEFAULT_ACCOUNTS.customers),
      parts: str(accounts.parts, DEFAULT_ACCOUNTS.parts),
      services: str(accounts.services, DEFAULT_ACCOUNTS.services),
      vat: str(accounts.vat, DEFAULT_ACCOUNTS.vat),
      cash: str(accounts.cash, DEFAULT_ACCOUNTS.cash),
      bank: str(accounts.bank, DEFAULT_ACCOUNTS.bank),
      mobileMoney: {
        ...DEFAULT_ACCOUNTS.mobileMoney,
        ...(obj(accounts.mobileMoney) as Partial<AccountingAccounts["mobileMoney"]>),
      },
      other: str(accounts.other, DEFAULT_ACCOUNTS.other),
      expenses: {
        ...DEFAULT_ACCOUNTS.expenses,
        ...(obj(accounts.expenses) as Record<string, string>),
      },
      defaultExpense: str(accounts.defaultExpense, DEFAULT_ACCOUNTS.defaultExpense),
    },
    merchantNumbers: merchantNumbersFrom(payments.merchantNumbers),
  };
}

function merchantNumbersFrom(value: unknown): MerchantNumbers {
  const raw = obj(value);
  const pick = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return {
    wave: pick(raw.wave),
    orangeMoney: pick(raw.orangeMoney),
    mtn: pick(raw.mtn),
    moov: pick(raw.moov),
  };
}
