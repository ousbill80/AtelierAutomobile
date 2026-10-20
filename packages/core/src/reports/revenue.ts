// RG-M12-03 à RG-M12-11 — CA, ventilation par nature, marges, panier moyen. Les entrées sont
// des **agrégats** (sommes SQL par type de facture × type de ligne), jamais des lignes une à
// une : le routeur groupe en base, `core/reports` applique les formules (M12 §1 : une seule
// définition pour le tableau de bord, les rapports, le résumé et l'assistant M17).

/** RG-M12-03 : statuts d'une « facture valide » (VOID et DRAFT exclus). */
export const VALID_INVOICE_STATUSES = [
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "DISPUTED",
  "WRITTEN_OFF",
] as const;

export type ReportLineType = "LABOR" | "PART" | "CONSUMABLE" | "SUBCONTRACT" | "FEE";
export type RevenueNature = "labor" | "parts" | "subcontract" | "fees";

/** RG-M12-07 : MO, Pièces (PART + CONSUMABLE), Sous-traitance, Frais. */
export function natureOf(lineType: string): RevenueNature {
  switch (lineType) {
    case "LABOR":
      return "labor";
    case "PART":
    case "CONSUMABLE":
      return "parts";
    case "SUBCONTRACT":
      return "subcontract";
    default:
      return "fees";
  }
}

/**
 * RG-M12-03 : un avoir est soustrait. M08 (RG-M08-12) émet des avoirs à montants négatifs, le
 * PRD M12 les décrit positifs : `−|x|` donne le même résultat dans les deux conventions.
 */
export function signedAmount(invoiceType: string, amount: number): number {
  return invoiceType === "CREDIT_NOTE" ? -Math.abs(amount) : amount;
}

export interface RevenueAggregateRow {
  invoiceType: "INVOICE" | "CREDIT_NOTE" | string;
  /** `null` : facture importée sans lignes (montants pris sur l'en-tête, comptés en Frais). */
  lineType: string | null;
  /** Σ `lineSubtotal` (HT net de remise) — ou `Invoice.subtotal` sans lignes. */
  subtotal: number;
  /** Σ `lineTotal` (TTC) — ou `Invoice.total`. */
  total: number;
  /** Σ `costAmount` figé à l'émission (M08 §14). */
  cost: number;
  /** Lignes pièces sans coût figé (`costAmount = 0`, prix > 0) : marge « coût estimée ». */
  uncostedLines?: number;
}

export interface RevenueSummary {
  ht: number;
  ttc: number;
  byNature: Record<RevenueNature, number>;
  /** Coût figé des pièces (PART + CONSUMABLE), avoirs déduits. */
  partsCost: number;
  /** Une ligne pièce n'avait pas de coût : la marge pièces est une estimation. */
  partsCostEstimated: boolean;
}

export function emptyNatures(): Record<RevenueNature, number> {
  return { labor: 0, parts: 0, subcontract: 0, fees: 0 };
}

/** RG-M12-05/06/07. */
export function computeRevenue(rows: readonly RevenueAggregateRow[]): RevenueSummary {
  const summary: RevenueSummary = {
    ht: 0,
    ttc: 0,
    byNature: emptyNatures(),
    partsCost: 0,
    partsCostEstimated: false,
  };
  for (const row of rows) {
    if (row.invoiceType !== "INVOICE" && row.invoiceType !== "CREDIT_NOTE") continue;
    const ht = signedAmount(row.invoiceType, row.subtotal);
    summary.ht += ht;
    summary.ttc += signedAmount(row.invoiceType, row.total);
    const nature = row.lineType ? natureOf(row.lineType) : "fees";
    summary.byNature[nature] += ht;
    if (nature === "parts") {
      summary.partsCost += signedAmount(row.invoiceType, row.cost);
      if ((row.uncostedLines ?? 0) > 0) summary.partsCostEstimated = true;
    }
  }
  return summary;
}

export const DEFAULT_MECHANIC_HOURLY_COST = 2_500;

export interface WorkedMinutesByMechanic {
  minutes: number;
  hourlyCost: number | null;
}

/**
 * RG-M12-09 : coût MO = Σ heures pointées × `Membership.hourlyCost` ; coût nul → défaut
 * `settings.costs.defaultMechanicHourlyCost` (2 500 FCFA/h) et « coût estimé ».
 */
export function laborCostOf(
  rows: readonly WorkedMinutesByMechanic[],
  defaultHourlyCost = DEFAULT_MECHANIC_HOURLY_COST,
): { cost: number; estimated: boolean } {
  let cost = 0;
  let estimated = false;
  for (const row of rows) {
    if (row.minutes <= 0) continue;
    const rate = row.hourlyCost && row.hourlyCost > 0 ? row.hourlyCost : null;
    if (rate === null) estimated = true;
    cost += Math.round((row.minutes / 60) * (rate ?? defaultHourlyCost));
  }
  return { cost, estimated };
}

/** Taux en flottant (RG-M12-04) ; division par zéro → null (« — »). */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export interface MarginSummary {
  partsMargin: number;
  partsRate: number | null;
  laborMargin: number;
  laborRate: number | null;
  grossMargin: number;
  grossRate: number | null;
  /** RG-M12-10 : coût de sous-traitance non suivi en v1 (« hors coût »). */
  subcontractUncosted: boolean;
  estimated: { parts: boolean; labor: boolean };
}

/** RG-M12-08/09/10. */
export function computeMargins(
  revenue: RevenueSummary,
  labor: { cost: number; estimated: boolean },
): MarginSummary {
  const partsMargin = revenue.byNature.parts - revenue.partsCost;
  const laborMargin = revenue.byNature.labor - labor.cost;
  const grossMargin =
    partsMargin + laborMargin + revenue.byNature.fees + revenue.byNature.subcontract;
  return {
    partsMargin,
    partsRate: ratio(partsMargin, revenue.byNature.parts),
    laborMargin,
    laborRate: ratio(laborMargin, revenue.byNature.labor),
    grossMargin,
    grossRate: ratio(grossMargin, revenue.ht),
    subcontractUncosted: revenue.byNature.subcontract !== 0,
    estimated: { parts: revenue.partsCostEstimated, labor: labor.estimated },
  };
}

/** RG-M12-11 : CA HT / nombre de factures valides de type INVOICE (avoirs hors dénominateur). */
export function averageTicket(revenueHt: number, invoiceCount: number): number | null {
  return invoiceCount > 0 ? Math.round(revenueHt / invoiceCount) : null;
}
