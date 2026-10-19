import { DomainError } from "../errors";
import { roundHalfUp } from "./round";

export interface InvoiceLineInput {
  /** Peut être décimale (ex. 4,5 L d'huile). */
  quantity: number;
  /** FCFA HT, entier. */
  unitPrice: number;
  /** Pourcentage 0-100. */
  discountRate?: number;
  /** Pourcentage appliqué si vatEnabled. */
  vatRate: number;
  /** RG-M08-08 : false si le régime de l'organisation n'applique pas la TVA. */
  vatEnabled?: boolean;
}

export interface InvoiceLineTotals {
  /** HT brut avant remise, round(quantity × unitPrice). */
  gross: number;
  /** HT net après remise. */
  lineSubtotal: number;
  lineVat: number;
  lineTotal: number;
}

/** RG-M08-05 — calcul d'une ligne de devis/facture, entiers FCFA. */
export function computeLine(input: InvoiceLineInput): InvoiceLineTotals {
  const { quantity, unitPrice, discountRate = 0, vatRate, vatEnabled = true } = input;

  if (discountRate < 0 || discountRate > 100) {
    throw new DomainError(
      "money.invalid_discount_rate",
      "La remise doit être comprise entre 0 et 100 %.",
      { discountRate },
    );
  }
  if (vatRate < 0) {
    throw new DomainError("money.invalid_vat_rate", "Le taux de TVA ne peut pas être négatif.", {
      vatRate,
    });
  }

  const rawGross = quantity * unitPrice;
  const gross = roundHalfUp(rawGross);
  const lineSubtotal = roundHalfUp((rawGross * (100 - discountRate)) / 100);
  const lineVat = vatEnabled ? roundHalfUp((lineSubtotal * vatRate) / 100) : 0;
  const lineTotal = lineSubtotal + lineVat;

  return { gross, lineSubtotal, lineVat, lineTotal };
}

export interface InvoiceTotals {
  /** HT brut avant remise, Σ gross. */
  grossSubtotal: number;
  /** Total des remises, grossSubtotal − subtotal. */
  discountTotal: number;
  /** HT net, Σ lineSubtotal. */
  subtotal: number;
  /** Σ lineVat. */
  vatTotal: number;
  /** TTC, Σ lineTotal. */
  total: number;
}

/** RG-M08-05 — agrège les totaux d'un devis/facture à partir de ses lignes calculées. */
export function computeInvoiceTotals(lines: InvoiceLineTotals[]): InvoiceTotals {
  const grossSubtotal = lines.reduce((sum, line) => sum + line.gross, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const vatTotal = lines.reduce((sum, line) => sum + line.lineVat, 0);
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  return { grossSubtotal, discountTotal: grossSubtotal - subtotal, subtotal, vatTotal, total };
}

/** RG-M08-07 — déduit le HT et la TVA d'un montant saisi TTC (ex. acompte). */
export function ttcToHt(ttc: number, vatRatePercent: number): { ht: number; vat: number } {
  if (vatRatePercent < 0) {
    throw new DomainError("money.invalid_vat_rate", "Le taux de TVA ne peut pas être négatif.", {
      vatRatePercent,
    });
  }
  const ht = roundHalfUp((ttc * 100) / (100 + vatRatePercent));
  return { ht, vat: ttc - ht };
}

/** RG-M08-05 : arrondi de la TVA par ligne (défaut) ou par taux sur la somme des HT. */
export type VatRounding = "line" | "total";

export interface DocumentLineInput extends InvoiceLineInput {
  /**
   * Montants figés imposés (acompte saisi TTC, déduction d'acompte, ligne d'avoir reprise à
   * l'identique) : ils ne sont pas recalculés, pour que la somme TTC tombe juste.
   */
  fixed?: { lineSubtotal: number; lineVat: number } | null;
}

export interface DocumentTotals {
  lines: InvoiceLineTotals[];
  totals: InvoiceTotals;
}

/**
 * RG-M08-05 — calcule les lignes et les totaux d'une facture / d'un avoir (quantités négatives
 * acceptées). En mode `total`, la TVA de chaque taux est calculée sur la somme des HT et l'écart
 * d'arrondi est reporté sur la plus grosse ligne de ce taux, pour que Σ TVA des lignes = TVA totale.
 */
export function computeDocumentTotals(
  inputs: readonly DocumentLineInput[],
  options: { vatEnabled?: boolean; vatRounding?: VatRounding } = {},
): DocumentTotals {
  const vatEnabled = options.vatEnabled ?? true;
  const lines = inputs.map((input): InvoiceLineTotals => {
    if (input.fixed) {
      const { lineSubtotal, lineVat } = input.fixed;
      return {
        gross: lineSubtotal,
        lineSubtotal,
        lineVat: vatEnabled ? lineVat : 0,
        lineTotal: lineSubtotal + (vatEnabled ? lineVat : 0),
      };
    }
    return computeLine({ ...input, vatEnabled: (input.vatEnabled ?? true) && vatEnabled });
  });
  if (options.vatRounding === "total" && vatEnabled) {
    const byRate = new Map<number, number[]>();
    inputs.forEach((input, i) => {
      if (input.fixed) return;
      const list = byRate.get(input.vatRate) ?? [];
      list.push(i);
      byRate.set(input.vatRate, list);
    });
    for (const [rate, indexes] of byRate) {
      const base = indexes.reduce((s, i) => s + lines[i]!.lineSubtotal, 0);
      const target = roundHalfUp((base * rate) / 100);
      const current = indexes.reduce((s, i) => s + lines[i]!.lineVat, 0);
      const diff = target - current;
      if (diff === 0) continue;
      const largest = indexes.reduce((best, i) =>
        Math.abs(lines[i]!.lineSubtotal) > Math.abs(lines[best]!.lineSubtotal) ? i : best,
      );
      const line = lines[largest]!;
      lines[largest] = { ...line, lineVat: line.lineVat + diff, lineTotal: line.lineTotal + diff };
    }
  }
  return { lines, totals: computeInvoiceTotals(lines) };
}
