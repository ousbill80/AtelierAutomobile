// RG-M12-18 — balance âgée à une date T. À aujourd'hui, le solde est `Invoice.balance` ; à une
// date passée, il est reconstitué : `total − Σ allocations des paiements reçus ≤ T − Σ avoirs
// émis ≤ T` pour les factures émises ≤ T. Tranches et retard : `core/receivables` (M09).
import { ageBucket, daysOverdue, type AgeBucket } from "../receivables/aging";

export interface AgedInvoiceInput {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  issuedAt: Date;
  dueDate: Date | null;
  total: number;
  /** Σ allocations (non annulées) des paiements reçus ≤ T. */
  paidAtDate: number;
  /** Σ |total| des avoirs émis ≤ T sur cette facture. */
  creditedAtDate: number;
  /** Perte constatée ≤ T (RG-M09-13) : la facture sort de la balance. */
  writtenOffAtDate?: boolean;
}

export interface AgedInvoiceRow {
  id: string;
  number: string | null;
  customerId: string;
  customerName: string;
  issuedAt: Date;
  dueDate: Date | null;
  total: number;
  paid: number;
  balance: number;
  daysLate: number;
  bucket: AgeBucket;
}

export interface AgedBalance {
  rows: AgedInvoiceRow[];
  total: number;
  buckets: Record<AgeBucket, number>;
  byCustomer: {
    customerId: string;
    customerName: string;
    total: number;
    buckets: Record<AgeBucket, number>;
  }[];
}

const emptyBuckets = (): Record<AgeBucket, number> => ({
  notDue: 0,
  b0_30: 0,
  b31_60: 0,
  b61_90: 0,
  b90p: 0,
});

/** `asOf` = date métier T (minuit UTC du jour local), convention des `@db.Date`. */
export function agedBalanceAt(invoices: readonly AgedInvoiceInput[], asOf: Date): AgedBalance {
  const rows: AgedInvoiceRow[] = [];
  const buckets = emptyBuckets();
  const customers = new Map<string, AgedBalance["byCustomer"][number]>();
  let total = 0;
  for (const invoice of invoices) {
    if (invoice.writtenOffAtDate) continue;
    const paid = invoice.paidAtDate + invoice.creditedAtDate;
    const balance = invoice.total - paid;
    if (balance <= 0) continue;
    const daysLate = daysOverdue(invoice.dueDate, asOf);
    const bucket = ageBucket(daysLate);
    rows.push({
      id: invoice.id,
      number: invoice.number,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      total: invoice.total,
      paid,
      balance,
      daysLate,
      bucket,
    });
    total += balance;
    buckets[bucket] += balance;
    const c = customers.get(invoice.customerId) ?? {
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      total: 0,
      buckets: emptyBuckets(),
    };
    c.total += balance;
    c.buckets[bucket] += balance;
    customers.set(invoice.customerId, c);
  }
  rows.sort(
    (a, b) =>
      a.customerName.localeCompare(b.customerName) ||
      b.daysLate - a.daysLate ||
      b.balance - a.balance,
  );
  return {
    rows,
    total,
    buckets,
    byCustomer: [...customers.values()].sort((a, b) => b.total - a.total),
  };
}
