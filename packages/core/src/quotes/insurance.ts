// RG-M05-13 — part assurance, franchise, écart avec le montant approuvé par l'expert.

export interface InsuranceSplitInput {
  /** TTC des lignes `payer = INSURANCE`. */
  insuranceLinesTotal: number;
  /** TTC total du devis (toutes lignes facturables). */
  total: number;
  /** Franchise (`InsuranceClaim.deductible`). */
  deductible: number;
}

export interface InsuranceSplit {
  insuranceShare: number;
  customerShare: number;
}

export function insuranceSplit(input: InsuranceSplitInput): InsuranceSplit {
  const insuranceShare = Math.max(0, input.insuranceLinesTotal - Math.max(0, input.deductible));
  return { insuranceShare, customerShare: input.total - insuranceShare };
}

export interface InsuranceGap {
  /** Écart positif = l'assureur approuve moins que la part calculée. */
  gap: number;
  /** Options proposées au conseiller (RG-M05-13). */
  options: Array<"COMMERCIAL_DISCOUNT" | "CHARGE_CUSTOMER">;
}

export function insuranceGap(insuranceShare: number, approvedAmount: number | null): InsuranceGap {
  if (approvedAmount == null || approvedAmount >= insuranceShare) return { gap: 0, options: [] };
  return {
    gap: insuranceShare - approvedAmount,
    options: ["COMMERCIAL_DISCOUNT", "CHARGE_CUSTOMER"],
  };
}
