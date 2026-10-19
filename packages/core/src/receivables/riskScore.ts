// RG-M09-12 — score de risque client (0-100, 100 = risque maximal), composantes affichées.

export interface RiskScoreInput {
  maxDaysOverdue: number;
  overdueDue: number;
  avgMonthlyBilled12m: number;
  brokenPromises12m: number;
  /** Factures des 12 derniers mois et part soldée au plus tard à échéance + 7 j. */
  invoices12m: number;
  onTimeRatio12m: number;
  unreachable: boolean;
  openDispute: boolean;
}

export interface RiskComponents {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
}

export interface RiskScoreResult {
  score: number;
  components: RiskComponents;
  label: RiskLabel;
}

export type RiskLabel = "GOOD" | "WATCH" | "RISKY" | "VERY_RISKY";

const round1 = (n: number) => Math.round(n * 10) / 10;

export function riskScore(input: RiskScoreInput): RiskScoreResult {
  const A = (Math.min(Math.max(input.maxDaysOverdue, 0), 120) / 120) * 35;
  const B = (Math.min(input.overdueDue / Math.max(input.avgMonthlyBilled12m, 50_000), 2) / 2) * 20;
  const C = (Math.min(Math.max(input.brokenPromises12m, 0), 3) / 3) * 15;
  const ratio = Math.min(Math.max(input.onTimeRatio12m, 0), 1);
  const D = input.invoices12m < 3 ? 10 : (1 - ratio) * 20;
  const E = (input.unreachable ? 5 : 0) + (input.openDispute ? 5 : 0);
  const score = Math.min(100, Math.max(0, Math.round(A + B + C + D + E)));
  return {
    score,
    components: { A: round1(A), B: round1(B), C: round1(C), D: round1(D), E },
    label: riskLabel(score),
  };
}

export function riskLabel(score: number): RiskLabel {
  if (score < 25) return "GOOD";
  if (score < 50) return "WATCH";
  if (score < 75) return "RISKY";
  return "VERY_RISKY";
}
