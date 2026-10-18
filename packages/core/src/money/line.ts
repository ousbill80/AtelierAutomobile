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
