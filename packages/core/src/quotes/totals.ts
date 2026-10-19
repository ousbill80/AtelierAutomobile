// RG-M05-03 / RG-M05-13 — totaux d'un devis : même calcul par ligne que l'OR (RG-M04-05),
// remise globale répartie au prorata (plus grand reste), TVA par ligne après remises,
// parts assurance / client.
import { DomainError } from "../errors";
import { computeLine } from "../money/line";
import { roundHalfUp } from "../money/round";
import type { QuoteLineLike } from "./types";

/**
 * Répartit `amount` FCFA au prorata de `bases` (méthode du plus grand reste) : la somme des
 * parts vaut exactement `amount` et aucune part ne dépasse sa base.
 * Ex. bases [100 000, 50 000], 9 000 → [6 000, 3 000].
 */
export function allocateGlobalDiscount(bases: readonly number[], amount: number): number[] {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new DomainError("quote.invalid_discount", "La remise doit être un montant positif.", {
      amount,
    });
  }
  const total = bases.reduce((s, b) => s + Math.max(0, b), 0);
  if (amount === 0 || bases.length === 0) return bases.map(() => 0);
  if (amount > total) {
    throw new DomainError(
      "quote.discount_exceeds_lines",
      "Remise supérieure au montant des lignes.",
      { amount, total },
    );
  }
  const exact = bases.map((b) => (Math.max(0, b) * amount) / total);
  const shares = exact.map((e) => Math.floor(e));
  let remainder = amount - shares.reduce((s, v) => s + v, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (shares[i]! < Math.max(0, bases[i]!)) {
      shares[i] = shares[i]! + 1;
      remainder -= 1;
    }
  }
  return shares;
}

/** Ligne facturée au client ou à l'assureur ; garantie et interne : affichées à 0. */
export function isBillableQuoteLine(line: Pick<QuoteLineLike, "payer">): boolean {
  return line.payer === "CUSTOMER" || line.payer === "INSURANCE";
}

export interface QuoteLineAmounts {
  id: string;
  billable: boolean;
  /** HT brut, round(qté × PU). */
  gross: number;
  /** Remise de la ligne (%). */
  lineDiscount: number;
  /** Part de la remise globale imputée à la ligne. */
  globalDiscount: number;
  /** HT net après toutes remises. */
  subtotal: number;
  vat: number;
  /** TTC. */
  total: number;
}

export interface QuoteTotalsOptions {
  vatEnabled?: boolean;
  globalDiscountRate?: number | null;
  globalDiscountAmount?: number | null;
  /** Franchise du sinistre (RG-M05-13). */
  deductible?: number | null;
}

export interface QuoteTotals {
  lines: QuoteLineAmounts[];
  /** Σ HT brut des lignes facturables (avant remise). */
  subtotal: number;
  /** Remises de ligne + remise globale. */
  discountTotal: number;
  /** Montant de la remise globale (FCFA). */
  globalDiscount: number;
  vatTotal: number;
  /** TTC = subtotal − discountTotal + vatTotal. */
  total: number;
  /** TTC des lignes acceptées. */
  acceptedTotal: number;
  /** TTC des lignes refusées. */
  declinedTotal: number;
  insuranceShare: number;
  customerShare: number;
  /** Taux de remise globale effectif (%), sur le HT après remises de ligne. */
  globalDiscountRateEffective: number;
}

function effectiveUnitPrice(line: QuoteLineLike): number {
  return line.type === "PART" && line.isCustomerSupplied ? 0 : line.unitPrice;
}

/** RG-M05-03 — totaux du devis (lignes garantie/interne exclues des montants). */
export function quoteTotals(
  lines: readonly QuoteLineLike[],
  options: QuoteTotalsOptions = {},
): QuoteTotals {
  const vatEnabled = options.vatEnabled ?? true;
  const base = lines.map((line) => {
    const c = computeLine({
      quantity: line.quantity,
      unitPrice: effectiveUnitPrice(line),
      discountRate: line.discountRate,
      vatRate: line.vatRate,
      vatEnabled,
    });
    return { line, billable: isBillableQuoteLine(line), gross: c.gross, net: c.lineSubtotal };
  });
  const billableNet = base.filter((b) => b.billable).reduce((s, b) => s + b.net, 0);

  let globalDiscount = 0;
  if (options.globalDiscountAmount != null && options.globalDiscountAmount > 0) {
    globalDiscount = options.globalDiscountAmount;
  } else if (options.globalDiscountRate != null && options.globalDiscountRate > 0) {
    if (options.globalDiscountRate > 100) {
      throw new DomainError(
        "quote.invalid_discount",
        "La remise doit être comprise entre 0 et 100 %.",
      );
    }
    globalDiscount = roundHalfUp((billableNet * options.globalDiscountRate) / 100);
  }
  const billableIdx = base.map((b, i) => (b.billable ? i : -1)).filter((i) => i >= 0);
  const shares = allocateGlobalDiscount(
    billableIdx.map((i) => base[i]!.net),
    globalDiscount,
  );
  const shareByIndex = new Map(billableIdx.map((i, k) => [i, shares[k]!]));

  const amounts: QuoteLineAmounts[] = base.map((b, i) => {
    const share = shareByIndex.get(i) ?? 0;
    const subtotal = b.net - share;
    const vat = vatEnabled ? roundHalfUp((subtotal * b.line.vatRate) / 100) : 0;
    return {
      id: b.line.id,
      billable: b.billable,
      gross: b.gross,
      lineDiscount: b.gross - b.net,
      globalDiscount: share,
      subtotal,
      vat,
      total: subtotal + vat,
    };
  });

  const billable = amounts.filter((a) => a.billable);
  const subtotal = billable.reduce((s, a) => s + a.gross, 0);
  const discountTotal = billable.reduce((s, a) => s + a.lineDiscount + a.globalDiscount, 0);
  const vatTotal = billable.reduce((s, a) => s + a.vat, 0);
  const total = subtotal - discountTotal + vatTotal;
  let acceptedTotal = 0;
  let declinedTotal = 0;
  let insuranceTotal = 0;
  amounts.forEach((a, i) => {
    if (!a.billable) return;
    const line = lines[i]!;
    if (line.accepted === true) acceptedTotal += a.total;
    if (line.accepted === false) declinedTotal += a.total;
    if (line.payer === "INSURANCE") insuranceTotal += a.total;
  });
  const split = insuranceSplit({
    total,
    insuranceLinesTotal: insuranceTotal,
    deductible: options.deductible ?? 0,
  });
  return {
    lines: amounts,
    subtotal,
    discountTotal,
    globalDiscount,
    vatTotal,
    total,
    acceptedTotal,
    declinedTotal,
    insuranceShare: split.insuranceShare,
    customerShare: split.customerShare,
    globalDiscountRateEffective:
      billableNet > 0 ? Math.round((globalDiscount * 10_000) / billableNet) / 100 : 0,
  };
}

/**
 * RG-M05-13 — part assurance = max(0, Σ TTC lignes INSURANCE − franchise) ;
 * part client = total − part assurance.
 */
export function insuranceSplit(input: {
  total: number;
  insuranceLinesTotal: number;
  deductible: number;
}): { insuranceShare: number; customerShare: number } {
  const insuranceShare = Math.max(0, input.insuranceLinesTotal - Math.max(0, input.deductible));
  return { insuranceShare, customerShare: input.total - insuranceShare };
}

/**
 * RG-M05-13 / US-M05-13 — l'assureur approuve un montant inférieur : écart à abandonner
 * (remise) ou à reporter sur le client (nouvelle version à faire accepter).
 */
export function insuranceApprovalGap(insuranceShare: number, approvedAmount: number): number {
  return Math.max(0, insuranceShare - Math.max(0, approvedAmount));
}
