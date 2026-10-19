// RG-M09-06 — promesses de paiement et échéanciers.
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import { addDays, diffDays } from "../reminders/dates";

export const MIN_PROMISE_AMOUNT = 1_000;
export const MAX_PROMISE_HORIZON_DAYS = 60;

export interface PromiseInstallment {
  amount: number;
  date: Date;
}

/** Valide un échéancier : montants entiers ≥ 1 000, dates dans [aujourd'hui ; +60 j], Σ ≤ dû. */
export function validatePromiseInstallments(
  installments: PromiseInstallment[],
  overdueDue: number,
  today: Date,
): void {
  if (installments.length === 0) {
    throw new DomainError("PROMISE_EMPTY", "Saisissez au moins une échéance.");
  }
  let sum = 0;
  for (const i of installments) {
    if (!Number.isInteger(i.amount) || i.amount < MIN_PROMISE_AMOUNT) {
      throw new DomainError(
        "PROMISE_AMOUNT_TOO_LOW",
        `Le montant promis doit être d'au moins ${formatFCFA(MIN_PROMISE_AMOUNT)}.`,
      );
    }
    const delta = diffDays(i.date, today);
    if (delta < 0) {
      throw new DomainError(
        "PROMISE_DATE_PAST",
        "La date promise doit être aujourd'hui ou plus tard.",
      );
    }
    if (delta > MAX_PROMISE_HORIZON_DAYS) {
      throw new DomainError(
        "PROMISE_DATE_TOO_FAR",
        "La date promise ne peut pas dépasser 60 jours : saisissez un échéancier.",
      );
    }
    sum += i.amount;
  }
  if (sum > overdueDue) {
    throw new DomainError(
      "PROMISE_EXCEEDS_DUE",
      `Le montant promis dépasse le solde dû (${formatFCFA(overdueDue)}).`,
    );
  }
}

/** `pausedUntil` = lendemain de la dernière échéance + `graceDays` (relances suspendues jusque-là). */
export function promisePausedUntil(installments: PromiseInstallment[], graceDays = 0): Date {
  const last = installments.reduce(
    (max, i) => (i.date.getTime() > max.getTime() ? i.date : max),
    installments[0]!.date,
  );
  return addDays(last, graceDays + 1);
}

export type PromiseEvaluation = "PENDING" | "KEPT" | "PARTIALLY_KEPT" | "BROKEN";

export interface EvaluatePromiseInput {
  amount: number;
  promisedDate: Date;
  /** Σ des affectations sur les factures du dossier depuis la création de la promesse. */
  paid: number;
  today: Date;
  graceDays?: number;
}

/**
 * Promesse échue si `promisedDate + graceDays < today`. Un paiement suffisant avant la date
 * rend la promesse `KEPT` immédiatement ; sinon elle reste `PENDING` jusqu'à l'échéance.
 */
export function evaluatePromise({
  amount,
  promisedDate,
  paid,
  today,
  graceDays = 0,
}: EvaluatePromiseInput): PromiseEvaluation {
  if (paid >= amount) return "KEPT";
  const expired = diffDays(today, addDays(promisedDate, graceDays)) > 0;
  if (!expired) return "PENDING";
  return paid > 0 ? "PARTIALLY_KEPT" : "BROKEN";
}

/**
 * Répartit les paiements reçus sur un échéancier dans l'ordre des dates : chaque échéance
 * consomme ce qui reste avant de passer à la suivante.
 */
export function distributePaidAcrossInstallments(
  installments: { id: string; amount: number; promisedDate: Date }[],
  totalPaid: number,
): Map<string, number> {
  const out = new Map<string, number>();
  let remaining = totalPaid;
  const sorted = [...installments].sort(
    (a, b) => a.promisedDate.getTime() - b.promisedDate.getTime(),
  );
  for (const i of sorted) {
    const part = Math.min(remaining, i.amount);
    out.set(i.id, part);
    remaining -= part;
  }
  return out;
}
