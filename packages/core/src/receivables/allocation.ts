// Sous-ensemble de M08 nécessaire au mode REMINDERS_ONLY : affectation d'un paiement aux
// factures ouvertes et recalcul du solde (`balance = total − amountPaid`, entiers FCFA).
import { DomainError } from "../errors";

export interface AllocatableInvoice {
  id: string;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  dueDate: Date | null;
  issuedAt: Date | null;
}

export interface AllocationLine {
  invoiceId: string;
  amount: number;
}

export interface AllocatePaymentInput {
  amount: number;
  invoices: AllocatableInvoice[];
  /** Affectation explicite choisie par l'utilisateur ; sinon plus ancienne échéance d'abord. */
  explicit?: AllocationLine[];
  /** RG-M08-19 : facture depuis laquelle on encaisse, soldée en premier. */
  currentInvoiceId?: string | null;
}

export interface AllocatePaymentResult {
  allocations: AllocationLine[];
  unallocated: number;
}

const ALLOCATABLE = ["ISSUED", "PARTIALLY_PAID", "OVERDUE"];

/**
 * RG-M09-17 / M08 : plus ancienne échéance d'abord, factures en litige ou en perte exclues
 * de l'affectation automatique. Le reliquat devient `Payment.unallocated` (acompte).
 */
export function allocatePayment({
  amount,
  invoices,
  explicit,
  currentInvoiceId,
}: AllocatePaymentInput): AllocatePaymentResult {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  const byId = new Map(invoices.map((i) => [i.id, i]));
  if (explicit && explicit.length > 0) {
    let sum = 0;
    for (const line of explicit) {
      const invoice = byId.get(line.invoiceId);
      if (!invoice) throw new DomainError("INVOICE_NOT_FOUND", "Facture introuvable.");
      if (!Number.isInteger(line.amount) || line.amount <= 0) {
        throw new DomainError("INVALID_AMOUNT", "Chaque affectation doit être un entier positif.");
      }
      if (line.amount > invoice.balance) {
        throw new DomainError(
          "ALLOCATION_EXCEEDS_BALANCE",
          "Le montant affecté dépasse le reste dû de la facture.",
        );
      }
      sum += line.amount;
    }
    if (sum > amount) {
      throw new DomainError(
        "ALLOCATION_EXCEEDS_PAYMENT",
        "Les affectations dépassent le montant payé.",
      );
    }
    return { allocations: explicit.map((l) => ({ ...l })), unallocated: amount - sum };
  }
  const eligible = invoices
    .filter((i) => ALLOCATABLE.includes(i.status) && i.balance > 0)
    .sort(
      (a, b) =>
        Number(b.id === currentInvoiceId) - Number(a.id === currentInvoiceId) ||
        sortKey(a) - sortKey(b) ||
        issuedKey(a) - issuedKey(b) ||
        a.id.localeCompare(b.id),
    );
  let remaining = amount;
  const allocations: AllocationLine[] = [];
  for (const invoice of eligible) {
    if (remaining === 0) break;
    const part = Math.min(remaining, invoice.balance);
    allocations.push({ invoiceId: invoice.id, amount: part });
    remaining -= part;
  }
  return { allocations, unallocated: remaining };
}

function sortKey(i: AllocatableInvoice): number {
  return (i.dueDate ?? i.issuedAt ?? new Date(8.64e15)).getTime();
}

function issuedKey(i: AllocatableInvoice): number {
  return (i.issuedAt ?? new Date(8.64e15)).getTime();
}

export interface InvoiceBalanceState {
  amountPaid: number;
  balance: number;
  status: string;
}

/**
 * Recalcul après affectation : `PAID` si soldée, `PARTIALLY_PAID` si entamée, sinon le
 * statut courant est conservé (`OVERDUE` reste `OVERDUE`, RG-M09 §5.3).
 */
export function applyAllocation(
  invoice: Pick<AllocatableInvoice, "total" | "amountPaid" | "status">,
  delta: number,
): InvoiceBalanceState {
  const amountPaid = invoice.amountPaid + delta;
  if (amountPaid < 0 || amountPaid > invoice.total) {
    throw new DomainError("ALLOCATION_EXCEEDS_BALANCE", "Le montant affecté dépasse le reste dû.");
  }
  const balance = invoice.total - amountPaid;
  let status = invoice.status;
  if (balance === 0) status = "PAID";
  else if (invoice.status === "ISSUED" && amountPaid > 0) status = "PARTIALLY_PAID";
  else if (invoice.status === "PAID") status = "PARTIALLY_PAID";
  return { amountPaid, balance, status };
}
