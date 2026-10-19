// RG-M12-17 (créances en cours), RG-M12-18 (balance âgée), RG-M12-19 (DSO) — vue tableau de
// bord. Une seule définition des créances : périmètre (`isOpenReceivable`, assurance exclue),
// retard (`daysOverdue`) et tranches (`ageBucket`) viennent de `core/receivables` (M09), pour
// que le tableau de bord, le module créances et le résumé quotidien affichent les mêmes chiffres.
import {
  ageBucket,
  daysOverdue,
  isOpenReceivable,
  type AgeBucket,
  type AgingInvoice,
} from "../receivables/aging";

export interface ReceivableInvoiceLike extends AgingInvoice {
  customerName?: string;
  number?: string | null;
}

export interface ReceivablesSummary {
  total: number;
  count: number;
  overdue: number;
  over30: number;
  disputed: number;
  buckets: Record<AgeBucket, number>;
}

/** Jour local `yyyy-MM-dd` → date métier (minuit UTC), convention des `@db.Date`. */
export function asOfDate(today: string): Date {
  return new Date(`${today}T00:00:00.000Z`);
}

/** RG-M12-17 : factures `INVOICE` client ouvertes ; acomptes et avoirs hors encours. */
function countsAsReceivable(invoice: ReceivableInvoiceLike): boolean {
  return invoice.type === "INVOICE" && isOpenReceivable(invoice);
}

export function computeReceivables(
  invoices: readonly ReceivableInvoiceLike[],
  today: string,
): ReceivablesSummary {
  const asOf = asOfDate(today);
  const summary: ReceivablesSummary = {
    total: 0,
    count: 0,
    overdue: 0,
    over30: 0,
    disputed: 0,
    buckets: { notDue: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 },
  };
  for (const invoice of invoices) {
    if (!countsAsReceivable(invoice)) continue;
    const days = daysOverdue(invoice.dueDate, asOf);
    summary.total += invoice.balance;
    summary.count += 1;
    if (days > 0) summary.overdue += invoice.balance;
    if (days > 30) summary.over30 += invoice.balance;
    if (invoice.status === "DISPUTED") summary.disputed += invoice.balance;
    summary.buckets[ageBucket(days)] += invoice.balance;
  }
  return summary;
}

export interface TopUnpaidEntry {
  customerId: string;
  customerName: string;
  balance: number;
  invoiceCount: number;
  maxDaysLate: number;
}

/** Top N des clients débiteurs (solde décroissant, puis retard décroissant). */
export function topUnpaid(
  invoices: readonly ReceivableInvoiceLike[],
  today: string,
  limit = 5,
): TopUnpaidEntry[] {
  const asOf = asOfDate(today);
  const byCustomer = new Map<string, TopUnpaidEntry>();
  for (const invoice of invoices) {
    if (!countsAsReceivable(invoice)) continue;
    const entry = byCustomer.get(invoice.customerId) ?? {
      customerId: invoice.customerId,
      customerName: invoice.customerName ?? "",
      balance: 0,
      invoiceCount: 0,
      maxDaysLate: 0,
    };
    entry.balance += invoice.balance;
    entry.invoiceCount += 1;
    entry.maxDaysLate = Math.max(entry.maxDaysLate, daysOverdue(invoice.dueDate, asOf));
    byCustomer.set(invoice.customerId, entry);
  }
  return [...byCustomer.values()]
    .sort((a, b) => b.balance - a.balance || b.maxDaysLate - a.maxDaysLate)
    .slice(0, limit);
}

/** RG-M12-19 : `round(encours TTC / CA TTC 90 j × 90)` ; CA nul → null (« — »). */
export function dso(outstanding: number, revenueTtc90d: number): number | null {
  if (revenueTtc90d <= 0) return null;
  return Math.round((outstanding / revenueTtc90d) * 90);
}

export interface AttributionFactLike {
  /** `PaymentAttribution.source` : reminder | call | spontaneous. */
  source: string;
  amount: number;
  /** `Payment.receivedAt` du paiement alloué. */
  receivedAt: Date;
}

/**
 * RG-M12-21/22 (A10) : montant récupéré grâce aux relances = Σ `PaymentAttribution.amount`
 * de source `reminder` dont le paiement est reçu dans `[from, to)`. L'attribution elle-même
 * (fenêtre 14 j, dernier contact) est faite une fois, à l'encaissement, par
 * `core/receivables/attribution` (M09).
 */
export function recoveredByReminders(
  attributions: readonly AttributionFactLike[],
  from: Date,
  to: Date,
): number {
  let sum = 0;
  for (const a of attributions) {
    const t = a.receivedAt.getTime();
    if (a.source === "reminder" && t >= from.getTime() && t < to.getTime()) sum += a.amount;
  }
  return sum;
}
