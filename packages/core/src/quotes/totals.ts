// RG-M05-03 — totaux d'un devis : même calcul de ligne que l'OR (`core/money/line`), remise
// globale répartie au prorata (plus grand reste), TVA par ligne, part assurance / client.
import { DomainError } from "../errors";
import { computeLine } from "../money/line";
import { roundHalfUp } from "../money/round";
import type { Payer, QuoteLineLike } from "./types";

export interface QuoteLineAmounts {
  /** HT brut avant toute remise. */
  gross: number;
  /** HT après remise de ligne, avant remise globale. */
  afterLineDiscount: number;
  /** Part de remise globale imputée à la ligne (FCFA). */
  globalDiscount: number;
  /** HT net (après remise de ligne et remise globale). */
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

export interface QuoteTotalsOptions {
  vatEnabled?: boolean;
  /** Remise globale en % (exclusive avec `globalDiscountAmount`). */
  globalDiscountRate?: number | null;
  /** Remise globale en FCFA. */
  globalDiscountAmount?: number | null;
  /** Franchise du sinistre (RG-M05-13), imputée au client. */
  deductible?: number | null;
}

export interface QuoteTotals {
  /** Σ gross (HT avant remise). */
  subtotal: number;
  /** Σ remises de ligne + remise globale. */
  discountTotal: number;
  vatTotal: number;
  /** TTC. */
  total: number;
  /** TTC des lignes `accepted = true` (calculé, dénormalisé à la décision). */
  acceptedTotal: number;
  /** TTC des lignes `accepted = false`. */
  declinedTotal: number;
  insuranceShare: number;
  customerShare: number;
  /** Montants par ligne, dans l'ordre d'entrée. */
  lines: QuoteLineAmounts[];
}

/** Lignes affichées à 0 pour le client (prises en charge par le garage). */
export function isCustomerChargeable(payer: Payer): boolean {
  return payer === "CUSTOMER" || payer === "INSURANCE";
}

/**
 * Répartit `amount` sur `bases` au prorata (méthode du plus grand reste), chaque part étant
 * bornée par sa base. Lève `quotes.discount_exceeds_lines` si la remise dépasse la somme.
 */
export function allocateGlobalDiscount(bases: readonly number[], amount: number): number[] {
  if (amount < 0) {
    throw new DomainError("quotes.negative_discount", "La remise ne peut pas être négative.");
  }
  const sum = bases.reduce((s, b) => s + Math.max(0, b), 0);
  if (amount === 0 || bases.length === 0) return bases.map(() => 0);
  if (amount > sum) {
    throw new DomainError(
      "quotes.discount_exceeds_lines",
      "Remise supérieure au montant des lignes.",
      { amount, sum },
    );
  }
  const raw = bases.map((b) => (Math.max(0, b) * amount) / sum);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = amount - floored.reduce((s, v) => s + v, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floored[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    if (floored[i]! < bases[i]!) {
      floored[i]! += 1;
      remainder -= 1;
    }
  }
  return floored;
}

/** Montants d'une ligne isolée (sans remise globale). Pièce fournie par le client = 0. */
export function quoteLineAmounts(line: QuoteLineLike, vatEnabled = true): QuoteLineAmounts {
  const unitPrice = line.type === "PART" && line.isCustomerSupplied ? 0 : line.unitPrice;
  const computed = computeLine({
    quantity: line.quantity,
    unitPrice,
    discountRate: line.discountRate,
    vatRate: line.vatRate,
    vatEnabled,
  });
  return {
    gross: computed.gross,
    afterLineDiscount: computed.lineSubtotal,
    globalDiscount: 0,
    lineSubtotal: computed.lineSubtotal,
    lineVat: computed.lineVat,
    lineTotal: computed.lineTotal,
  };
}

/** RG-M05-03 — totaux complets du devis (exemple PRD : 201 780 TTC, accepté 60 180). */
export function quoteTotals(
  lines: readonly QuoteLineLike[],
  options: QuoteTotalsOptions = {},
): QuoteTotals {
  const vatEnabled = options.vatEnabled ?? true;
  if (
    options.globalDiscountRate != null &&
    options.globalDiscountRate !== 0 &&
    options.globalDiscountAmount != null &&
    options.globalDiscountAmount !== 0
  ) {
    throw new DomainError(
      "quotes.discount_rate_and_amount",
      "Indiquez une remise globale en % ou en FCFA, pas les deux.",
    );
  }
  const base = lines.map((l) => quoteLineAmounts(l, vatEnabled));
  // Lignes garantie / interne : non facturées au client, exclues de l'assiette de remise.
  const chargeable = lines.map((l) => isCustomerChargeable(l.payer));
  const bases = base.map((b, i) => (chargeable[i] ? b.afterLineDiscount : 0));
  const basesSum = bases.reduce((s, b) => s + b, 0);

  let globalAmount = 0;
  if (options.globalDiscountAmount) globalAmount = options.globalDiscountAmount;
  else if (options.globalDiscountRate) {
    if (options.globalDiscountRate < 0 || options.globalDiscountRate > 100) {
      throw new DomainError(
        "money.invalid_discount_rate",
        "La remise doit être comprise entre 0 et 100 %.",
      );
    }
    globalAmount = roundHalfUp((basesSum * options.globalDiscountRate) / 100);
  }
  const allocation = allocateGlobalDiscount(bases, globalAmount);

  const detailed: QuoteLineAmounts[] = base.map((b, i) => {
    if (!chargeable[i]) {
      return { ...b, globalDiscount: 0, lineSubtotal: 0, lineVat: 0, lineTotal: 0 };
    }
    const lineSubtotal = b.afterLineDiscount - allocation[i]!;
    const lineVat = vatEnabled ? roundHalfUp((lineSubtotal * lines[i]!.vatRate) / 100) : 0;
    return {
      ...b,
      globalDiscount: allocation[i]!,
      lineSubtotal,
      lineVat,
      lineTotal: lineSubtotal + lineVat,
    };
  });

  let subtotal = 0;
  let discountTotal = 0;
  let vatTotal = 0;
  let total = 0;
  let acceptedTotal = 0;
  let declinedTotal = 0;
  let insuranceLinesTotal = 0;
  lines.forEach((line, i) => {
    if (!chargeable[i]) return;
    const d = detailed[i]!;
    subtotal += d.gross;
    discountTotal += d.gross - d.lineSubtotal;
    vatTotal += d.lineVat;
    total += d.lineTotal;
    if (line.accepted === true) acceptedTotal += d.lineTotal;
    if (line.accepted === false) declinedTotal += d.lineTotal;
    if (line.payer === "INSURANCE") insuranceLinesTotal += d.lineTotal;
  });
  const deductible = Math.max(0, options.deductible ?? 0);
  const insuranceShare = Math.max(0, insuranceLinesTotal - deductible);
  return {
    subtotal,
    discountTotal,
    vatTotal,
    total,
    acceptedTotal,
    declinedTotal,
    insuranceShare,
    customerShare: total - insuranceShare,
    lines: detailed,
  };
}
