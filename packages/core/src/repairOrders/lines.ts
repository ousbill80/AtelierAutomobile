// RG-M04-05 / RG-M04-06 — montants des lignes d'OR, partagés avec M05 et M08 via `computeLine`.
import { computeInvoiceTotals, computeLine, type InvoiceTotals } from "../money/line";
import { roundHalfUp } from "../money/round";
import type { ApprovalState, LineStatus, LineType, Payer } from "./types";

export interface RepairOrderLineLike {
  type: LineType;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  status: LineStatus;
  approval: ApprovalState;
  payer: Payer;
  isCustomerSupplied?: boolean;
}

export interface LineAmounts {
  gross: number;
  subtotal: number;
  vat: number;
  total: number;
}

/** RG-M04-05 : gross → remise → HT → TVA arrondie par ligne → TTC. Pièce fournie par le client = 0. */
export function lineAmounts(line: RepairOrderLineLike, vatEnabled = true): LineAmounts {
  const unitPrice = line.type === "PART" && line.isCustomerSupplied ? 0 : line.unitPrice;
  const totals = computeLine({
    quantity: line.quantity,
    unitPrice,
    discountRate: line.discountRate,
    vatRate: line.vatRate,
    vatEnabled,
  });
  return {
    gross: totals.gross,
    subtotal: totals.lineSubtotal,
    vat: totals.lineVat,
    total: totals.lineTotal,
  };
}

/** Ligne comptée dans les totaux de l'OR : ni annulée, ni refusée (RG-M04-05). */
export function isCountedLine(line: Pick<RepairOrderLineLike, "status" | "approval">): boolean {
  return line.status !== "CANCELLED" && line.approval !== "DECLINED";
}

/** Ligne approuvée pour le travail (mécanicien autorisé, RG-M04-08). */
export function isWorkableLine(line: Pick<RepairOrderLineLike, "status" | "approval">): boolean {
  return (
    line.status !== "CANCELLED" &&
    (line.approval === "APPROVED" || line.approval === "NOT_REQUIRED")
  );
}

/** Ligne facturée au client ou à l'assureur (garantie et interne : coût garage). */
export function isBillableLine(line: Pick<RepairOrderLineLike, "payer">): boolean {
  return line.payer === "CUSTOMER" || line.payer === "INSURANCE";
}

export interface RepairOrderTotals extends InvoiceTotals {
  /** RG-M04-05 : TTC des lignes approuvées (ou sans accord requis) facturables. */
  totalEstimate: number;
  /** TTC en attente d'accord client. */
  pendingTotal: number;
}

/** Totaux affichés sur l'OR (lignes non annulées, non refusées, facturables). */
export function repairOrderTotals(
  lines: readonly RepairOrderLineLike[],
  vatEnabled = true,
): RepairOrderTotals {
  const counted = lines.filter((l) => isCountedLine(l) && isBillableLine(l));
  const computed = counted.map((l) => {
    const a = lineAmounts(l, vatEnabled);
    return { gross: a.gross, lineSubtotal: a.subtotal, lineVat: a.vat, lineTotal: a.total };
  });
  const totals = computeInvoiceTotals(computed);
  let totalEstimate = 0;
  let pendingTotal = 0;
  counted.forEach((l, i) => {
    const total = computed[i]!.lineTotal;
    if (l.approval === "APPROVED" || l.approval === "NOT_REQUIRED") totalEstimate += total;
    if (l.approval === "PENDING") pendingTotal += total;
  });
  return { ...totals, totalEstimate, pendingTotal };
}

// ───────────── RG-M04-06 — prix de la main-d'œuvre (A3 : settings.labor.rates) ─────────────

export type LaborRateType = "STANDARD" | "DIAGNOSTIC" | "BODYWORK" | "ELECTRICAL";
export type LaborRates = Record<LaborRateType, number>;

export const DEFAULT_LABOR_RATES: LaborRates = {
  STANDARD: 15_000,
  DIAGNOSTIC: 20_000,
  BODYWORK: 15_000,
  ELECTRICAL: 18_000,
};

export interface LaborOperationLike {
  standardHours: number;
  rateType: LaborRateType;
  fixedPrice?: number | null;
}

/** Quantité (heures) et PU HT d'une ligne MO issue du catalogue. Forfait → 1 × fixedPrice. */
export function laborLinePricing(
  op: LaborOperationLike,
  rates: LaborRates = DEFAULT_LABOR_RATES,
): { quantity: number; unitPrice: number } {
  if (op.fixedPrice !== null && op.fixedPrice !== undefined) {
    return { quantity: 1, unitPrice: op.fixedPrice };
  }
  return { quantity: op.standardHours, unitPrice: rates[op.rateType] ?? rates.STANDARD };
}

/** RG-M04-07 : la MO se saisit au quart d'heure près (0,25 h). */
export function roundLaborHours(hours: number): number {
  return roundHalfUp(hours * 4) / 4;
}
