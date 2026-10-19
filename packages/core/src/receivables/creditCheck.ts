// RG-M09-10 — contrôle du crédit à l'ouverture d'un OR, d'un devis ou d'une facture à crédit.
import { formatFCFA } from "../money/format";

export type CreditLevel = "OK" | "WARN" | "BLOCK";

export type CreditReason =
  "CREDIT_HOLD" | "OVER_LIMIT" | "NEAR_LIMIT" | "OVERDUE_TOO_LONG" | "ESCALATED" | "OVERDUE";

export interface CreditCheckInput {
  totalDue: number;
  overdueDue: number;
  maxDaysOverdue: number;
  creditLimit: number | null;
  creditHold: boolean;
  caseEscalated: boolean;
  additionalAmount?: number;
  blockAfterDays?: number;
}

export interface CreditCheckResult {
  level: CreditLevel;
  reasons: CreditReason[];
  exposure: number;
  message: string | null;
}

export function creditCheck(input: CreditCheckInput): CreditCheckResult {
  const blockAfterDays = input.blockAfterDays ?? 60;
  const exposure = input.totalDue + Math.max(0, input.additionalAmount ?? 0);
  const block: CreditReason[] = [];
  if (input.creditHold) block.push("CREDIT_HOLD");
  if (input.creditLimit !== null && exposure > input.creditLimit) block.push("OVER_LIMIT");
  if (input.maxDaysOverdue > blockAfterDays) block.push("OVERDUE_TOO_LONG");
  if (input.caseEscalated) block.push("ESCALATED");
  if (block.length > 0) {
    const message =
      block.includes("OVER_LIMIT") && input.creditLimit !== null
        ? `Plafond de crédit dépassé : ${formatFCFA(input.totalDue)} dus (plafond ${formatFCFA(input.creditLimit)}). Paiement comptant exigé ou dérogation d'un responsable.`
        : `Crédit suspendu : ${formatFCFA(input.overdueDue)} en retard depuis ${input.maxDaysOverdue} jours. Paiement comptant exigé ou dérogation d'un responsable.`;
    return { level: "BLOCK", reasons: block, exposure, message };
  }
  const warn: CreditReason[] = [];
  if (input.overdueDue > 0) warn.push("OVERDUE");
  if (
    input.creditLimit !== null &&
    input.creditLimit > 0 &&
    exposure * 100 >= input.creditLimit * 80
  ) {
    warn.push("NEAR_LIMIT");
  }
  if (warn.length > 0) {
    const message =
      input.overdueDue > 0
        ? `Ce client a ${formatFCFA(input.overdueDue)} impayés depuis ${input.maxDaysOverdue} jours. Pensez à en parler à l'accueil.`
        : `Ce client approche de son plafond de crédit (${formatFCFA(exposure)} sur ${formatFCFA(input.creditLimit ?? 0)}).`;
    return { level: "WARN", reasons: warn, exposure, message };
  }
  return { level: "OK", reasons: [], exposure, message: null };
}
