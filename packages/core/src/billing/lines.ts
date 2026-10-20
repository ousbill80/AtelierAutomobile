// M08 — construction des lignes de facture : depuis un OR (US-M08-01), acompte et déduction
// d'acompte (US-M08-03, RG-M08-07), avoir total ou partiel (US-M08-04, RG-M08-12).
import { DomainError } from "../errors";
import {
  computeDocumentTotals,
  ttcToHt,
  type DocumentLineInput,
  type InvoiceTotals,
  type VatRounding,
} from "../money/line";
import { formatFCFA } from "../money/format";
import { roundHalfUp } from "../money/round";

export type InvoiceLineTypeLike = "LABOR" | "PART" | "SUBCONTRACT" | "FEE" | "CONSUMABLE";
export type PayerLike = "CUSTOMER" | "INSURANCE" | "WARRANTY" | "INTERNAL";

/** Ligne de facture avant écriture (montants calculés par {@link computeDraftTotals}). */
export interface DraftInvoiceLine {
  type: InvoiceLineTypeLike;
  productId: string | null;
  laborOperationId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  payer: PayerLike;
  repairOrderLineId: string | null;
  depositInvoiceId: string | null;
  /** Coût unitaire (CMP de la pièce, coût de sous-traitance) pour la marge (M12). */
  unitCost: number | null;
  fixed: { lineSubtotal: number; lineVat: number } | null;
}

export interface ComputedInvoiceLine extends DraftInvoiceLine {
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
  costAmount: number;
}

export interface DraftTotals {
  lines: ComputedInvoiceLine[];
  totals: InvoiceTotals;
  costTotal: number;
}

/** RG-M08-05/08 — calcule les montants de chaque ligne et les totaux du document. */
export function computeDraftTotals(
  lines: readonly DraftInvoiceLine[],
  options: { vatEnabled: boolean; vatRounding?: VatRounding },
): DraftTotals {
  const inputs: DocumentLineInput[] = lines.map((l) => ({
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountRate: l.discountRate,
    vatRate: options.vatEnabled ? l.vatRate : 0,
    fixed: l.fixed,
  }));
  const { lines: computed, totals } = computeDocumentTotals(inputs, options);
  const out = lines.map((line, i) => {
    const c = computed[i]!;
    return {
      ...line,
      vatRate: options.vatEnabled ? line.vatRate : 0,
      lineSubtotal: c.lineSubtotal,
      lineVat: c.lineVat,
      lineTotal: c.lineTotal,
      costAmount: line.unitCost ? roundHalfUp(line.unitCost * line.quantity) : 0,
    };
  });
  return { lines: out, totals, costTotal: out.reduce((s, l) => s + l.costAmount, 0) };
}

// ───────────── Depuis un OR (US-M08-01) ─────────────

export interface RepairOrderLineForInvoice {
  id: string;
  type: InvoiceLineTypeLike;
  productId: string | null;
  laborOperationId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  status: string;
  approval: string;
  payer: PayerLike;
  isCustomerSupplied: boolean;
  costPrice: number | null;
  sortOrder: number;
  /** CMP courant du produit lié (pièces), à défaut `costPrice`. */
  productAverageCost?: number | null;
}

export const CUSTOMER_SUPPLIED_MENTION = "Pièce fournie par le client — non garantie par le garage";

/**
 * US-M08-01 : lignes non annulées et non refusées ; `CUSTOMER` → facture client,
 * `INSURANCE` → facture assurance (M16), `WARRANTY` / `INTERNAL` non facturées.
 */
export function splitRepairOrderLines(lines: readonly RepairOrderLineForInvoice[]): {
  customer: DraftInvoiceLine[];
  insurance: DraftInvoiceLine[];
  notBilled: number;
} {
  const customer: DraftInvoiceLine[] = [];
  const insurance: DraftInvoiceLine[] = [];
  let notBilled = 0;
  const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  for (const l of sorted) {
    if (l.status === "CANCELLED" || l.approval === "DECLINED") continue;
    if (l.payer === "WARRANTY" || l.payer === "INTERNAL") {
      notBilled++;
      continue;
    }
    const draft: DraftInvoiceLine = {
      type: l.type,
      productId: l.productId,
      laborOperationId: l.laborOperationId,
      description: l.isCustomerSupplied
        ? `${l.description} (${CUSTOMER_SUPPLIED_MENTION})`
        : l.description,
      quantity: l.quantity,
      unitPrice: l.isCustomerSupplied ? 0 : l.unitPrice,
      discountRate: l.discountRate,
      vatRate: l.vatRate,
      payer: l.payer,
      repairOrderLineId: l.id,
      depositInvoiceId: null,
      unitCost: l.isCustomerSupplied ? null : (l.productAverageCost ?? l.costPrice ?? null),
      fixed: null,
    };
    (l.payer === "INSURANCE" ? insurance : customer).push(draft);
  }
  return { customer, insurance, notBilled };
}

// ───────────── Acomptes (US-M08-03) ─────────────

/** RG-M08-07 — ligne unique d'une facture d'acompte saisie TTC. */
export function buildDepositLine(input: {
  reference: string | null;
  amountTtc: number;
  vatRate: number;
}): DraftInvoiceLine {
  if (!Number.isInteger(input.amountTtc) || input.amountTtc <= 0) {
    throw new DomainError("billing.invalid_deposit", "Le montant de l'acompte doit être positif.");
  }
  const { ht, vat } = ttcToHt(input.amountTtc, input.vatRate);
  return {
    type: "FEE",
    productId: null,
    laborOperationId: null,
    description: input.reference ? `Acompte sur devis ${input.reference}` : "Acompte",
    quantity: 1,
    unitPrice: ht,
    discountRate: 0,
    vatRate: input.vatRate,
    payer: "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: null,
    fixed: { lineSubtotal: ht, lineVat: vat },
  };
}

export interface DepositForDeduction {
  id: string;
  number: string | null;
  type: string;
  status: string;
  customerId: string;
  subtotal: number;
  vatTotal: number;
  vatRate: number;
  /** Une ligne de déduction existe déjà sur une facture émise ou un brouillon. */
  alreadyDeducted: boolean;
}

/** US-M08-03 — ligne négative « Déduction acompte FAC-… » ; acompte payé, déduit une seule fois. */
export function buildDepositDeduction(
  deposit: DepositForDeduction,
  customerId: string,
): DraftInvoiceLine {
  if (deposit.type !== "DEPOSIT") {
    throw new DomainError("billing.not_a_deposit", "Ce document n'est pas une facture d'acompte.");
  }
  if (deposit.customerId !== customerId) {
    throw new DomainError(
      "billing.deposit_other_customer",
      "Cet acompte appartient à un autre client.",
    );
  }
  if (deposit.status !== "PAID") {
    throw new DomainError(
      "billing.deposit_not_paid",
      `L'acompte ${deposit.number ?? "brouillon"} n'est pas encore payé : il ne peut pas être déduit.`,
    );
  }
  if (deposit.alreadyDeducted) {
    throw new DomainError(
      "billing.deposit_already_deducted",
      `L'acompte ${deposit.number} a déjà été déduit d'une facture.`,
    );
  }
  return {
    type: "FEE",
    productId: null,
    laborOperationId: null,
    description: `Déduction acompte ${deposit.number}`,
    quantity: 1,
    unitPrice: -deposit.subtotal,
    discountRate: 0,
    vatRate: deposit.vatRate,
    payer: "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: deposit.id,
    unitCost: null,
    fixed: { lineSubtotal: -deposit.subtotal, lineVat: -deposit.vatTotal },
  };
}

// ───────────── Avoirs (US-M08-04, RG-M08-12) ─────────────

export interface CreditableLine {
  id: string;
  type: InvoiceLineTypeLike;
  productId: string | null;
  laborOperationId: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  payer: PayerLike;
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
  costAmount: number;
}

export interface CreditNoteSelection {
  invoiceLineId: string;
  quantity: number;
}

export interface CreditNotePlan {
  lines: ComputedInvoiceLine[];
  totals: InvoiceTotals;
  /** |total| de l'avoir. */
  amount: number;
  /** L'avoir solde entièrement la facture : elle passe `VOID`. */
  isFull: boolean;
}

/**
 * RG-M08-12 — lignes négatives de l'avoir. `FULL` reprend chaque ligne à l'identique (montants
 * figés) ; une sélection reprend les quantités choisies (calcul RG-M08-05 avec quantité négative).
 * L'avoir ne peut pas dépasser `total − Σ avoirs précédents`.
 */
export function planCreditNote(input: {
  invoice: { total: number; creditedAmount: number; lines: readonly CreditableLine[] };
  selection: "FULL" | readonly CreditNoteSelection[];
  vatEnabled: boolean;
}): CreditNotePlan {
  const { invoice, selection } = input;
  const remaining = invoice.total - invoice.creditedAmount;
  if (remaining <= 0) {
    throw new DomainError(
      "billing.credit_nothing_left",
      "Cette facture est déjà entièrement couverte par des avoirs.",
    );
  }
  const drafts: DraftInvoiceLine[] = [];
  const base = (l: CreditableLine): Omit<DraftInvoiceLine, "quantity" | "fixed" | "unitCost"> => ({
    type: l.type,
    productId: l.productId,
    laborOperationId: l.laborOperationId,
    description: l.description,
    unitPrice: l.unitPrice,
    discountRate: l.discountRate,
    vatRate: l.vatRate,
    payer: l.payer,
    repairOrderLineId: null,
    depositInvoiceId: null,
  });
  const unitCostOf = (l: CreditableLine) => (l.quantity !== 0 ? l.costAmount / l.quantity : null);
  if (selection === "FULL") {
    if (invoice.creditedAmount > 0) {
      throw new DomainError(
        "billing.credit_full_after_partial",
        "Un avoir partiel existe déjà : sélectionnez les lignes et quantités restant à créditer.",
      );
    }
    for (const l of invoice.lines) {
      drafts.push({
        ...base(l),
        quantity: -l.quantity,
        unitCost: unitCostOf(l),
        fixed: { lineSubtotal: -l.lineSubtotal, lineVat: -l.lineVat },
      });
    }
  } else {
    if (selection.length === 0) {
      throw new DomainError("billing.credit_empty", "Sélectionnez au moins une ligne à créditer.");
    }
    const byId = new Map(invoice.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const s of selection) {
      const l = byId.get(s.invoiceLineId);
      if (!l) throw new DomainError("billing.credit_line_unknown", "Ligne de facture introuvable.");
      if (seen.has(l.id)) {
        throw new DomainError("billing.credit_line_twice", "Une ligne est sélectionnée deux fois.");
      }
      seen.add(l.id);
      if (!(s.quantity > 0) || s.quantity > Math.abs(l.quantity)) {
        throw new DomainError(
          "billing.credit_quantity",
          `Quantité à créditer invalide pour « ${l.description} » (maximum ${Math.abs(l.quantity)}).`,
        );
      }
      const whole = s.quantity === Math.abs(l.quantity);
      drafts.push({
        ...base(l),
        quantity: -s.quantity,
        unitCost: unitCostOf(l),
        fixed: whole ? { lineSubtotal: -l.lineSubtotal, lineVat: -l.lineVat } : null,
      });
    }
  }
  const computed = computeDraftTotals(drafts, { vatEnabled: input.vatEnabled });
  const amount = -computed.totals.total;
  if (amount <= 0) {
    throw new DomainError("billing.credit_zero", "L'avoir doit porter sur un montant positif.");
  }
  if (amount > remaining) {
    throw new DomainError(
      "billing.credit_exceeds",
      `L'avoir ne peut pas dépasser ${formatFCFA(remaining)}.`,
      { remaining },
    );
  }
  return {
    lines: computed.lines,
    totals: computed.totals,
    amount,
    isFull: amount === remaining,
  };
}
