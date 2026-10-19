// RG-M09-01 (échéance et retard) et RG-M09-02 (balance âgée). Dates métier = minuit UTC
// d'un `@db.Date` ; `asOf` est le jour courant dans le fuseau de l'organisation.
import { addDays, diffDays } from "../reminders/dates";

export type AgeBucket = "notDue" | "b0_30" | "b31_60" | "b61_90" | "b90p";

export const AGE_BUCKETS: readonly AgeBucket[] = ["notDue", "b0_30", "b31_60", "b61_90", "b90p"];

/** Statuts dont le solde compte dans la balance âgée (RG-M09-01, RG-M09-13 : perte exclue). */
export const OPEN_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] as const;

/** Statuts relançables : un litige suspend la relance (RG-M09-08). */
export const OVERDUE_ELIGIBLE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] as const;

export interface AgingInvoice {
  id: string;
  customerId: string;
  type: "INVOICE" | "CREDIT_NOTE" | "DEPOSIT";
  status: string;
  billTo?: "CUSTOMER" | "INSURANCE" | string;
  balance: number;
  dueDate: Date | null;
}

/** `dueDate = date d'émission locale + paymentTermsDays` (comptant : jour d'émission). */
export function computeDueDate(issuedLocalDate: Date, paymentTermsDays: number): Date {
  return addDays(issuedLocalDate, Math.max(0, Math.trunc(paymentTermsDays)));
}

/** `max(0, asOf − dueDate)` en jours calendaires. Sans échéance : 0. */
export function daysOverdue(dueDate: Date | null, asOf: Date): number {
  if (!dueDate) return 0;
  return Math.max(0, diffDays(asOf, dueDate));
}

export function ageBucket(days: number): AgeBucket {
  if (days <= 0) return "notDue";
  if (days <= 30) return "b0_30";
  if (days <= 60) return "b31_60";
  if (days <= 90) return "b61_90";
  return "b90p";
}

/** Une facture compte-t-elle dans les créances client (hors assurance, hors avoir, solde > 0) ? */
export function isOpenReceivable(invoice: AgingInvoice): boolean {
  return (
    invoice.type !== "CREDIT_NOTE" &&
    (invoice.billTo ?? "CUSTOMER") === "CUSTOMER" &&
    invoice.balance > 0 &&
    (OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status)
  );
}

/** RG-M09-01 : en retard si solde > 0, retard ≥ 1 j et statut relançable. */
export function isOverdue(invoice: AgingInvoice, asOf: Date): boolean {
  return (
    isOpenReceivable(invoice) &&
    (OVERDUE_ELIGIBLE_STATUSES as readonly string[]).includes(invoice.status) &&
    daysOverdue(invoice.dueDate, asOf) >= 1
  );
}

export interface AgingSummary {
  total: number;
  notDue: number;
  buckets: { b0_30: number; b31_60: number; b61_90: number; b90p: number };
  /** Crédits non affectés (paiements `unallocated` + avoirs non imputés), négatif ou 0. */
  unallocatedCredits: number;
  customersCount: number;
  customersByBucket: Record<AgeBucket, number>;
}

export interface AgingSummaryInput {
  invoices: AgingInvoice[];
  /** Montants positifs : `Payment.unallocated` et soldes d'avoirs non imputés. */
  unallocatedCredits?: number[];
  asOf: Date;
}

/**
 * RG-M09-02 : chaque facture tombe dans une seule tranche selon sa propre échéance. La somme
 * des tranches (non échu inclus) est égale à `total` ; les crédits sont présentés à part.
 */
export function agingSummary({
  invoices,
  unallocatedCredits = [],
  asOf,
}: AgingSummaryInput): AgingSummary {
  const amounts: Record<AgeBucket, number> = { notDue: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
  const customers: Record<AgeBucket, Set<string>> = {
    notDue: new Set(),
    b0_30: new Set(),
    b31_60: new Set(),
    b61_90: new Set(),
    b90p: new Set(),
  };
  const all = new Set<string>();
  let credits = 0;
  for (const invoice of invoices) {
    if (invoice.type === "CREDIT_NOTE") {
      credits += Math.abs(invoice.balance);
      continue;
    }
    if (!isOpenReceivable(invoice)) continue;
    const bucket = ageBucket(daysOverdue(invoice.dueDate, asOf));
    amounts[bucket] += invoice.balance;
    customers[bucket].add(invoice.customerId);
    all.add(invoice.customerId);
  }
  for (const c of unallocatedCredits) credits += Math.max(0, c);
  const total = AGE_BUCKETS.reduce((sum, b) => sum + amounts[b], 0);
  return {
    total,
    notDue: amounts.notDue,
    buckets: {
      b0_30: amounts.b0_30,
      b31_60: amounts.b31_60,
      b61_90: amounts.b61_90,
      b90p: amounts.b90p,
    },
    unallocatedCredits: credits === 0 ? 0 : -credits,
    customersCount: all.size,
    customersByBucket: {
      notDue: customers.notDue.size,
      b0_30: customers.b0_30.size,
      b31_60: customers.b31_60.size,
      b61_90: customers.b61_90.size,
      b90p: customers.b90p.size,
    },
  };
}

export interface CustomerExposure {
  totalDue: number;
  overdueDue: number;
  oldestDueDate: Date | null;
  maxDaysOverdue: number;
  disputedDue: number;
}

/** Totaux d'un client (RG-M09-03) : `totalDue` échu ou non, `overdueDue` échu relançable. */
export function customerExposure(invoices: AgingInvoice[], asOf: Date): CustomerExposure {
  let totalDue = 0;
  let overdueDue = 0;
  let disputedDue = 0;
  let oldest: Date | null = null;
  let maxDays = 0;
  for (const invoice of invoices) {
    if (!isOpenReceivable(invoice)) continue;
    totalDue += invoice.balance;
    if (invoice.status === "DISPUTED") {
      disputedDue += invoice.balance;
      continue;
    }
    if (isOverdue(invoice, asOf)) {
      overdueDue += invoice.balance;
      const days = daysOverdue(invoice.dueDate, asOf);
      if (days > maxDays) maxDays = days;
      if (!oldest || invoice.dueDate!.getTime() < oldest.getTime()) oldest = invoice.dueDate;
    }
  }
  return { totalDue, overdueDue, oldestDueDate: oldest, maxDaysOverdue: maxDays, disputedDue };
}

/** RG-M09-09 : `relançable = overdueDue − litiges − crédits non affectés`, jamais négatif. */
export function remindableAmount(input: {
  overdueDue: number;
  unallocatedCredits: number;
}): number {
  return Math.max(0, input.overdueDue - Math.abs(input.unallocatedCredits));
}
