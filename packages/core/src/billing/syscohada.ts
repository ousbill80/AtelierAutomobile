// RG-M08-31 — écritures comptables SYSCOHADA (journaux VT, EN, CA) et export CSV.
import { DomainError } from "../errors";
import type { AccountingAccounts, PaymentMethodLike } from "./settings";

export type JournalCode = "VT" | "EN" | "CA";

export interface AccountingEntry {
  journal: JournalCode;
  /** dd/MM/yyyy (fuseau de l'organisation, formaté par l'appelant). */
  date: string;
  piece: string;
  account: string;
  thirdParty: string;
  label: string;
  debit: number;
  credit: number;
  reference: string;
}

export interface SalesDocument {
  number: string;
  date: string;
  type: "INVOICE" | "DEPOSIT" | "CREDIT_NOTE";
  customerName: string;
  customerAccount: string;
  /** Pour un avoir : numéro de la facture d'origine. */
  reference?: string | null;
  lines: { type: string; lineSubtotal: number }[];
  vatTotal: number;
  total: number;
}

export interface CashMovementDocument {
  piece: string;
  date: string;
  method: PaymentMethodLike;
  customerName: string;
  customerAccount: string;
  amount: number;
  reference?: string | null;
  /** Remboursement au client : écriture inverse. */
  isRefund?: boolean;
}

export interface ExpenseDocument {
  piece: string;
  date: string;
  category: string;
  description: string;
  amount: number;
}

export interface CashDropDocument {
  piece: string;
  date: string;
  amount: number;
  destination: "safe" | "bank";
}

/** Pièces (PART, CONSUMABLE) → ventes de marchandises ; MO, sous-traitance, frais → prestations. */
export function salesAccountFor(lineType: string, accounts: AccountingAccounts): string {
  return lineType === "PART" || lineType === "CONSUMABLE" ? accounts.parts : accounts.services;
}

export function treasuryAccountFor(
  method: PaymentMethodLike,
  accounts: AccountingAccounts,
): string {
  switch (method) {
    case "CASH":
      return accounts.cash;
    case "WAVE":
    case "ORANGE_MONEY":
    case "MTN_MOMO":
    case "MOOV_MONEY":
      return accounts.mobileMoney[method];
    case "CARD":
    case "BANK_TRANSFER":
    case "CHEQUE":
      return accounts.bank;
    case "INSURANCE":
      return accounts.customers;
    default:
      return accounts.other;
  }
}

/** Montant signé → (débit, crédit) : une valeur négative passe de l'autre côté. */
function side(amount: number, natural: "debit" | "credit"): { debit: number; credit: number } {
  const positive = amount >= 0;
  const value = Math.abs(amount);
  if ((natural === "debit") === positive) return { debit: value, credit: 0 };
  return { debit: 0, credit: value };
}

/** Journal VT : débit 411 TTC / crédit 701-706 HT / crédit 4431 TVA ; avoir = écriture inverse. */
export function salesEntries(
  docs: readonly SalesDocument[],
  accounts: AccountingAccounts,
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  for (const doc of docs) {
    const label = `${doc.type === "CREDIT_NOTE" ? "Avoir" : "Facture"} ${doc.number} ${doc.customerName}`;
    const reference = doc.reference ?? doc.number;
    const base = { journal: "VT" as const, date: doc.date, piece: doc.number, reference, label };
    entries.push({
      ...base,
      account: accounts.customers,
      thirdParty: doc.customerAccount,
      ...side(doc.total, "debit"),
    });
    const byAccount = new Map<string, number>();
    for (const line of doc.lines) {
      const account = salesAccountFor(line.type, accounts);
      byAccount.set(account, (byAccount.get(account) ?? 0) + line.lineSubtotal);
    }
    for (const [account, amount] of byAccount) {
      if (amount === 0) continue;
      entries.push({ ...base, account, thirdParty: "", ...side(amount, "credit") });
    }
    if (doc.vatTotal !== 0) {
      entries.push({
        ...base,
        account: accounts.vat,
        thirdParty: "",
        ...side(doc.vatTotal, "credit"),
      });
    }
  }
  return entries;
}

/** Journal EN : débit trésorerie (571 / 521 / 585…) / crédit 411 ; remboursement = inverse. */
export function receiptEntries(
  docs: readonly CashMovementDocument[],
  accounts: AccountingAccounts,
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  for (const doc of docs) {
    const amount = doc.isRefund ? -doc.amount : doc.amount;
    const base = {
      journal: "EN" as const,
      date: doc.date,
      piece: doc.piece,
      reference: doc.reference ?? doc.piece,
      label: `${doc.isRefund ? "Remboursement" : "Encaissement"} ${doc.piece} ${doc.customerName}`,
    };
    entries.push({
      ...base,
      account: treasuryAccountFor(doc.method, accounts),
      thirdParty: "",
      ...side(amount, "debit"),
    });
    entries.push({
      ...base,
      account: accounts.customers,
      thirdParty: doc.customerAccount,
      ...side(amount, "credit"),
    });
  }
  return entries;
}

/** Journal CA : dépenses (débit 6xx / crédit 571) et versements en banque (débit 521 / crédit 571). */
export function cashEntries(
  expenses: readonly ExpenseDocument[],
  drops: readonly CashDropDocument[],
  accounts: AccountingAccounts,
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  for (const e of expenses) {
    const base = {
      journal: "CA" as const,
      date: e.date,
      piece: e.piece,
      reference: e.piece,
      label: `${e.category} — ${e.description}`,
      thirdParty: "",
    };
    entries.push({
      ...base,
      account: accounts.expenses[e.category] ?? accounts.defaultExpense,
      debit: e.amount,
      credit: 0,
    });
    entries.push({ ...base, account: accounts.cash, debit: 0, credit: e.amount });
  }
  // Un versement au coffre reste dans le compte caisse : seul le versement en banque s'écrit.
  for (const d of drops.filter((x) => x.destination === "bank")) {
    const base = {
      journal: "CA" as const,
      date: d.date,
      piece: d.piece,
      reference: d.piece,
      label: "Versement en banque",
      thirdParty: "",
    };
    entries.push({ ...base, account: accounts.bank, debit: d.amount, credit: 0 });
    entries.push({ ...base, account: accounts.cash, debit: 0, credit: d.amount });
  }
  return entries;
}

/** Contrôle avant export : chaque pièce est équilibrée (Σ débit = Σ crédit). */
export function assertBalanced(entries: readonly AccountingEntry[]): {
  debit: number;
  credit: number;
} {
  const byPiece = new Map<string, number>();
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    const key = `${e.journal}|${e.piece}`;
    byPiece.set(key, (byPiece.get(key) ?? 0) + e.debit - e.credit);
    debit += e.debit;
    credit += e.credit;
  }
  for (const [key, diff] of byPiece) {
    if (diff !== 0) {
      throw new DomainError(
        "accounting.unbalanced",
        `Écriture déséquilibrée pour la pièce ${key.split("|")[1]} (écart ${diff}).`,
      );
    }
  }
  return { debit, credit };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const SYSCOHADA_HEADER = [
  "Journal",
  "Date",
  "N° pièce",
  "Compte",
  "Compte tiers",
  "Libellé",
  "Débit",
  "Crédit",
  "Référence",
];

/** CSV `;`, UTF-8 avec BOM, montants entiers (RG-M08-31). */
export function toCsv(header: readonly string[], rows: readonly (string | number)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function syscohadaCsv(entries: readonly AccountingEntry[]): string {
  assertBalanced(entries);
  return toCsv(
    SYSCOHADA_HEADER,
    entries.map((e) => [
      e.journal,
      e.date,
      e.piece,
      e.account,
      e.thirdParty,
      e.label,
      e.debit,
      e.credit,
      e.reference,
    ]),
  );
}
