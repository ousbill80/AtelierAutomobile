// RG-M08-18/20/26 — validation d'un encaissement saisi au comptoir.
import { DomainError } from "../errors";
import { formatFCFA } from "../money/format";
import { MOBILE_MONEY_METHODS, type PaymentMethodLike } from "./settings";

export const METHOD_LABELS: Record<PaymentMethodLike, string> = {
  CASH: "Espèces",
  WAVE: "Wave",
  ORANGE_MONEY: "Orange Money",
  MTN_MOMO: "MTN MoMo",
  MOOV_MONEY: "Moov Money",
  CARD: "Carte",
  BANK_TRANSFER: "Virement",
  CHEQUE: "Chèque",
  INSURANCE: "Assurance",
  OTHER: "Autre",
};

const REFERENCE_REQUIRED: ReadonlySet<PaymentMethodLike> = new Set([
  ...MOBILE_MONEY_METHODS,
  "CHEQUE",
  "BANK_TRANSFER",
]);

export function isMobileMoney(method: PaymentMethodLike): boolean {
  return MOBILE_MONEY_METHODS.includes(method);
}

/** Référence normalisée (espaces retirés, majuscules) pour le contrôle d'unicité RG-M08-26. */
export function normalizePaymentReference(reference: string | null | undefined): string | null {
  const value = (reference ?? "").trim().replace(/\s+/g, " ");
  return value === "" ? null : value.toUpperCase();
}

export interface PaymentInputCheck {
  method: PaymentMethodLike;
  amount: number;
  reference: string | null | undefined;
  hasOpenCashSession: boolean;
}

/**
 * RG-M08-18 : référence obligatoire pour le mobile money saisi à la main, le chèque et le
 * virement ; `CASH` exige une caisse ouverte sur le site. Renvoie le statut initial :
 * chèque `PENDING` (RG-M08-20), sinon `CONFIRMED`.
 */
export function checkPaymentInput(input: PaymentInputCheck): {
  reference: string | null;
  status: "PENDING" | "CONFIRMED";
} {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  const reference = normalizePaymentReference(input.reference);
  if (REFERENCE_REQUIRED.has(input.method) && !reference) {
    const what = isMobileMoney(input.method)
      ? `l'identifiant de la transaction ${METHOD_LABELS[input.method]}`
      : input.method === "CHEQUE"
        ? "le numéro du chèque et la banque"
        : "la référence du virement";
    throw new DomainError("payment.reference_required", `Indiquez ${what}.`);
  }
  if (input.method === "CASH" && !input.hasOpenCashSession) {
    throw new DomainError(
      "payment.cash_session_closed",
      "Ouvrez la caisse pour encaisser en espèces.",
    );
  }
  return { reference, status: input.method === "CHEQUE" ? "PENDING" : "CONFIRMED" };
}

/** RG-M08-26 — message du doublon de référence mobile money. */
export function duplicateReferenceMessage(method: PaymentMethodLike, receipt: string): string {
  return `Cette référence ${METHOD_LABELS[method]} a déjà été enregistrée sur ${receipt}.`;
}

/** RG-M08-22 — un remboursement ne dépasse jamais le disponible (trop-perçu ou crédit). */
export function checkRefund(input: {
  amount: number;
  available: number;
  method: PaymentMethodLike;
  reference: string | null | undefined;
  hasOpenCashSession: boolean;
}): { reference: string | null } {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new DomainError("INVALID_AMOUNT", "Le montant doit être un entier positif en FCFA.");
  }
  if (input.amount > input.available) {
    throw new DomainError(
      "refund.exceeds_available",
      `Le remboursement ne peut pas dépasser ${formatFCFA(input.available)} disponibles.`,
    );
  }
  const reference = normalizePaymentReference(input.reference);
  if (isMobileMoney(input.method) && !reference) {
    throw new DomainError(
      "refund.reference_required",
      "Indiquez la référence du transfert mobile money.",
    );
  }
  if (input.method === "CASH" && !input.hasOpenCashSession) {
    throw new DomainError(
      "payment.cash_session_closed",
      "Ouvrez la caisse pour rembourser en espèces.",
    );
  }
  return { reference };
}
