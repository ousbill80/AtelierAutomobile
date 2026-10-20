// RG-M08-10/11/12 — solde et statut dérivé d'une facture, effet d'un avoir.
import { DomainError } from "../errors";
import { addDays } from "../reminders/dates";
import { businessDate } from "../calendar";
import {
  assertCanIssueInvoice,
  type OrganizationIdentityForInvoicing,
} from "../organization/identity";

/** Statuts posés explicitement : jamais recalculés à partir du solde. */
const EXPLICIT_STATUSES: ReadonlySet<string> = new Set([
  "DRAFT",
  "VOID",
  "WRITTEN_OFF",
  "DISPUTED",
]);

export interface InvoiceBalanceInput {
  status: string;
  type?: string;
  total: number;
  /** Σ affectations actives des paiements CONFIRMED et des crédits clients. */
  amountPaid: number;
  creditedAmount: number;
  dueDate: Date | null;
  /** Date métier du jour (minuit UTC du jour dans le fuseau de l'organisation). */
  today: Date;
}

export interface DerivedInvoiceState {
  amountPaid: number;
  balance: number;
  status: string;
}

/**
 * RG-M08-10/11 — `balance = total − amountPaid − creditedAmount` (jamais négatif) ;
 * soldée → `PAID` ; échue (`dueDate < aujourd'hui`) → `OVERDUE` ; entamée → `PARTIALLY_PAID` ;
 * sinon `ISSUED`. Un avoir n'a pas de solde propre (il reste `ISSUED`).
 */
export function deriveInvoiceStatus(input: InvoiceBalanceInput): DerivedInvoiceState {
  const balance = Math.max(0, input.total - input.amountPaid - input.creditedAmount);
  if (input.type === "CREDIT_NOTE") {
    return { amountPaid: input.amountPaid, balance: 0, status: input.status };
  }
  if (EXPLICIT_STATUSES.has(input.status)) {
    return { amountPaid: input.amountPaid, balance, status: input.status };
  }
  let status: string;
  if (balance === 0) status = "PAID";
  else if (input.dueDate && input.dueDate.getTime() < input.today.getTime()) status = "OVERDUE";
  else if (input.amountPaid + input.creditedAmount > 0) status = "PARTIALLY_PAID";
  else status = "ISSUED";
  return { amountPaid: input.amountPaid, balance, status };
}

export interface CreditEffect {
  creditedAmount: number;
  /** Part de l'avoir dépassant le solde dû (facture déjà payée) → `CustomerCredit`. */
  customerCredit: number;
}

/** RG-M08-12 — effet d'un avoir de `amount` sur la facture d'origine. */
export function creditNoteEffect(input: {
  total: number;
  amountPaid: number;
  creditedAmount: number;
  amount: number;
}): CreditEffect {
  const creditedAmount = input.creditedAmount + input.amount;
  const due = input.total - input.amountPaid - input.creditedAmount;
  const customerCredit = Math.max(0, input.amount - Math.max(0, due));
  return { creditedAmount, customerCredit };
}

// ───────────── Émission (RG-M08-01/03/04) ─────────────

export type FneModeLike = "api" | "manual" | "disabled";

export interface IssueInput {
  invoice: { status: string; type: string; total: number; lineCount: number };
  organization: OrganizationIdentityForInvoicing;
  now: Date;
  timeZone: string;
  /** `issuedAt` de la dernière facture émise de l'organisation (pas d'antidatage). */
  lastIssuedAt: Date | null;
  paymentTermsDays: number;
  fneMode: FneModeLike | null;
}

export interface IssuePlan {
  issuedAt: Date;
  dueDate: Date;
  /** Année de la séquence, dans le fuseau de l'organisation (RG-M08-01). */
  year: number;
  docType: "FAC" | "AV";
  fneStatus: "NOT_REQUIRED" | "PENDING";
}

export function planIssue(input: IssueInput): IssuePlan {
  const { invoice } = input;
  if (invoice.status !== "DRAFT") {
    throw new DomainError("billing.not_draft", "Cette facture est déjà émise.");
  }
  if (invoice.lineCount === 0) {
    throw new DomainError("billing.no_lines", "Ajoutez au moins une ligne avant d'émettre.");
  }
  if (invoice.type !== "CREDIT_NOTE" && invoice.total < 0) {
    throw new DomainError(
      "billing.negative_total",
      "Le total de la facture ne peut pas être négatif.",
    );
  }
  assertCanIssueInvoice(input.organization);
  if (input.lastIssuedAt && input.lastIssuedAt.getTime() > input.now.getTime()) {
    throw new DomainError(
      "billing.backdated",
      "Une facture ne peut pas être datée avant la dernière facture émise.",
    );
  }
  const day = businessDate(input.now, input.timeZone);
  return {
    issuedAt: input.now,
    dueDate: addDays(day, Math.max(0, input.paymentTermsDays)),
    year: day.getUTCFullYear(),
    docType: invoice.type === "CREDIT_NOTE" ? "AV" : "FAC",
    fneStatus: input.fneMode === "disabled" ? "NOT_REQUIRED" : "PENDING",
  };
}
