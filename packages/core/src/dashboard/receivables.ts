// RG-M12-17 (créances en cours), RG-M12-18 (balance âgée), RG-M12-19 (DSO).
// Calcul isolé ici, à partir des seuls soldes `Invoice.balance` : quand l'étape 2.3 (M09 +
// paiements) aura fusionné, seule l'alimentation des `ReceivableInvoiceLike` change côté
// routeur (ex. solde reconstitué à une date passée), pas ces formules.

export const RECEIVABLE_STATUSES = ["ISSUED", "PARTIALLY_PAID", "OVERDUE", "DISPUTED"] as const;

export interface ReceivableInvoiceLike {
  id: string;
  type: string;
  status: string;
  balance: number;
  /** Échéance (date métier `@db.Date`, minuit UTC). */
  dueDate: Date | null;
  customerId: string;
  customerName?: string;
  number?: string | null;
}

export type AgingBucket = "notDue" | "d1_30" | "d31_60" | "d61_90" | "d90plus";

export interface ReceivablesSummary {
  total: number;
  count: number;
  overdue: number;
  over30: number;
  disputed: number;
  buckets: Record<AgingBucket, number>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Jours de retard `T − dueDate` (dates civiles). Sans échéance → 0 (non échu). */
export function daysLate(dueDate: Date | null, today: string): number {
  if (!dueDate) return 0;
  const t = new Date(`${today}T00:00:00.000Z`).getTime();
  const d = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return Math.round((t - d) / MS_PER_DAY);
}

/** RG-M12-18 : Non échu (d ≤ 0), 1–30, 31–60, 61–90, > 90. */
export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "notDue";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90plus";
}

function isOpenReceivable(
  invoice: Pick<ReceivableInvoiceLike, "type" | "status" | "balance">,
): boolean {
  return (
    invoice.type === "INVOICE" &&
    (RECEIVABLE_STATUSES as readonly string[]).includes(invoice.status) &&
    invoice.balance > 0
  );
}

export function computeReceivables(
  invoices: readonly ReceivableInvoiceLike[],
  today: string,
): ReceivablesSummary {
  const summary: ReceivablesSummary = {
    total: 0,
    count: 0,
    overdue: 0,
    over30: 0,
    disputed: 0,
    buckets: { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0 },
  };
  for (const invoice of invoices) {
    if (!isOpenReceivable(invoice)) continue;
    const days = daysLate(invoice.dueDate, today);
    summary.total += invoice.balance;
    summary.count += 1;
    if (days > 0) summary.overdue += invoice.balance;
    if (days > 30) summary.over30 += invoice.balance;
    if (invoice.status === "DISPUTED") summary.disputed += invoice.balance;
    summary.buckets[agingBucket(days)] += invoice.balance;
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
  const byCustomer = new Map<string, TopUnpaidEntry>();
  for (const invoice of invoices) {
    if (!isOpenReceivable(invoice)) continue;
    const entry = byCustomer.get(invoice.customerId) ?? {
      customerId: invoice.customerId,
      customerName: invoice.customerName ?? "",
      balance: 0,
      invoiceCount: 0,
      maxDaysLate: 0,
    };
    entry.balance += invoice.balance;
    entry.invoiceCount += 1;
    entry.maxDaysLate = Math.max(entry.maxDaysLate, daysLate(invoice.dueDate, today));
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
