// RG-M16-03/04/05/06 — répartition assureur / client d'un sinistre et construction des deux
// factures (assurance et client) sans double comptage. Montants entiers FCFA.
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import { ttcToHt } from "../money/line";
import { computeDraftTotals, type DraftInvoiceLine, type DraftTotals } from "../billing/lines";

export type VatPaidBy = "INSURANCE" | "CUSTOMER";

export interface SplitInput {
  /** E : total TTC des lignes `payer = INSURANCE`. */
  insuranceTotal: number;
  /** D : franchise TTC. */
  deductible: number;
  /** V : vétusté TTC retenue par l'assureur. */
  depreciation?: number;
  /** X : écart non accordé mis à la charge du client. */
  gap?: number;
  /** C : total TTC des lignes `payer = CUSTOMER`. */
  customerTotal?: number;
  /** Montant accordé par l'assureur (TTC, franchise et vétusté incluses), si saisi. */
  approvedAmount?: number | null;
}

export interface ClaimSplit {
  E: number;
  D: number;
  V: number;
  X: number;
  C: number;
  insurerShare: number;
  customerShare: number;
  /** La franchise (+ vétusté + écart) couvre toute la réparation : part assureur nulle. */
  underDeductible: boolean;
  /** partAssureur > approvedAmount − D − V : la part demandée dépasse l'accord. */
  exceedsApproval: boolean;
  /** G = E − approvedAmount (≥ 0) : écart à traiter (RG-M16-05). */
  approvalGap: number;
}

function nonNegative(value: number | undefined | null, label: string): number {
  const v = value ?? 0;
  if (!Number.isInteger(v) || v < 0) {
    throw new DomainError("claims.invalid_amount", `${label} : montant entier positif attendu.`);
  }
  return v;
}

/** RG-M16-03 — `partAssureur = E − D − V − X` (≥ 0), `partClient = D + V + X + C`. */
export function splitClaim(input: SplitInput): ClaimSplit {
  const E = nonNegative(input.insuranceTotal, "Total assurance");
  const D = nonNegative(input.deductible, "Franchise");
  const V = nonNegative(input.depreciation, "Vétusté");
  const X = nonNegative(input.gap, "Écart");
  const C = nonNegative(input.customerTotal, "Part client");
  const raw = E - D - V - X;
  const insurerShare = Math.max(0, raw);
  const customerShare = E + C - insurerShare;
  const approved = input.approvedAmount ?? null;
  return {
    E,
    D,
    V,
    X,
    C,
    insurerShare,
    customerShare,
    underDeductible: raw <= 0 && E > 0,
    exceedsApproval: approved !== null && insurerShare > approved - D - V,
    approvalGap: approved !== null ? Math.max(0, E - approved) : 0,
  };
}

export interface ClaimInvoicesInput {
  /** Lignes de l'OR / du devis `payer = INSURANCE` (prix et TVA réels). */
  insuranceLines: readonly DraftInvoiceLine[];
  /** Lignes `payer = CUSTOMER` (hors sinistre, demandées par le client). */
  customerLines: readonly DraftInvoiceLine[];
  deductible: number;
  depreciation?: number;
  gap?: number;
  vatPaidBy?: VatPaidBy;
  /** Taux de TVA de l'organisation (0 si non assujettie). */
  vatRate: number;
  vatEnabled: boolean;
  labels: { claimNumber: string; insuredName: string; policyNumber?: string | null };
}

export interface ClaimInvoices {
  insurer: DraftTotals;
  customer: DraftTotals;
  /** E et C recalculés (TTC) pour le contrôle d'invariant. */
  insuranceTotal: number;
  customerLinesTotal: number;
  split: ClaimSplit;
}

function fixedLine(
  description: string,
  ttc: number,
  vatRate: number,
  sign: 1 | -1,
  options: { withVat: boolean },
): DraftInvoiceLine {
  const { ht, vat } = ttcToHt(ttc, vatRate);
  return {
    type: "FEE",
    productId: null,
    laborOperationId: null,
    description,
    quantity: 1,
    unitPrice: sign * ht,
    discountRate: 0,
    vatRate: options.withVat ? vatRate : 0,
    payer: "CUSTOMER",
    repairOrderLineId: null,
    depositInvoiceId: null,
    unitCost: null,
    fixed: { lineSubtotal: sign * ht, lineVat: options.withVat ? sign * vat : 0 },
  };
}

/**
 * RG-M16-04 — facture assurance : lignes `INSURANCE` puis lignes négatives franchise / vétusté /
 * écart (TTC → HT, RG-M08-07) ; facture client : les mêmes montants en positif + lignes client.
 * RG-M16-06 (`vatPaidBy = CUSTOMER`) : l'assureur ne règle que le HT, la TVA des lignes assurance
 * (nette de celle de la franchise) passe sur la facture client. Invariant contrôlé :
 * `totalAssurance + totalClient = E + C`.
 */
export function buildClaimInvoices(input: ClaimInvoicesInput): ClaimInvoices {
  const vatPaidBy = input.vatPaidBy ?? "INSURANCE";
  const vatRate = input.vatEnabled ? input.vatRate : 0;
  const options = { vatEnabled: input.vatEnabled };
  const insuranceOnly = computeDraftTotals(input.insuranceLines, options);
  const customerOnly = computeDraftTotals(input.customerLines, options);
  const E = insuranceOnly.totals.total;
  const C = customerOnly.totals.total;
  const D = nonNegative(input.deductible, "Franchise");
  const V = nonNegative(input.depreciation, "Vétusté");
  const X = nonNegative(input.gap, "Écart");
  if (input.insuranceLines.length === 0) {
    throw new DomainError("claims.no_insurance_lines", "Aucune ligne à la charge de l'assurance.");
  }
  if (E - D - V - X < 0) {
    throw new DomainError(
      "claims.under_deductible",
      `La franchise et les retenues (${formatFCFA(D + V + X)}) dépassent le montant des réparations (${formatFCFA(E)}) : traitez le dossier comme une réparation client.`,
    );
  }
  const policy = input.labels.policyNumber ? ` (police n° ${input.labels.policyNumber})` : "";
  const retained: { label: string; customerLabel: string; ttc: number }[] = [
    {
      label: `Franchise à la charge de l'assuré — ${input.labels.insuredName}`,
      customerLabel: `Franchise sinistre ${input.labels.claimNumber}${policy}`,
      ttc: D,
    },
    {
      label: "Vétusté à la charge de l'assuré",
      customerLabel: `Vétusté sinistre ${input.labels.claimNumber}`,
      ttc: V,
    },
    {
      label: "Écart non pris en charge par l'assureur",
      customerLabel: `Écart non pris en charge — sinistre ${input.labels.claimNumber}`,
      ttc: X,
    },
  ].filter((r) => r.ttc > 0);

  const customerPays = vatPaidBy === "CUSTOMER";
  const insurerLines: DraftInvoiceLine[] = input.insuranceLines.map((l) =>
    customerPays ? { ...l, vatRate: 0 } : l,
  );
  const customerLines: DraftInvoiceLine[] = [];
  for (const r of retained) {
    insurerLines.push(fixedLine(r.label, r.ttc, vatRate, -1, { withVat: !customerPays }));
    customerLines.push(fixedLine(r.customerLabel, r.ttc, vatRate, 1, { withVat: true }));
  }
  if (customerPays && insuranceOnly.totals.vatTotal > 0) {
    const retainedVat = retained.reduce((s, r) => s + ttcToHt(r.ttc, vatRate).vat, 0);
    const vat = insuranceOnly.totals.vatTotal - retainedVat;
    customerLines.push({
      type: "FEE",
      productId: null,
      laborOperationId: null,
      description: `TVA sur réparation sinistre ${input.labels.claimNumber}`,
      quantity: 1,
      unitPrice: 0,
      discountRate: 0,
      vatRate,
      payer: "CUSTOMER",
      repairOrderLineId: null,
      depositInvoiceId: null,
      unitCost: null,
      fixed: { lineSubtotal: 0, lineVat: vat },
    });
  }
  customerLines.push(...input.customerLines);
  const insurer = computeDraftTotals(insurerLines, options);
  const customer = computeDraftTotals(customerLines, options);
  if (insurer.totals.total + customer.totals.total !== E + C) {
    throw new DomainError(
      "claims.split_invariant",
      "Répartition incohérente : la somme des deux factures ne correspond pas aux travaux.",
    );
  }
  return {
    insurer,
    customer,
    insuranceTotal: E,
    customerLinesTotal: C,
    // Parts réelles (en mode `vatPaidBy = CUSTOMER`, la TVA passe côté client).
    split: {
      ...splitClaim({
        insuranceTotal: E,
        deductible: D,
        depreciation: V,
        gap: X,
        customerTotal: C,
      }),
      insurerShare: insurer.totals.total,
      customerShare: customer.totals.total,
    },
  };
}
