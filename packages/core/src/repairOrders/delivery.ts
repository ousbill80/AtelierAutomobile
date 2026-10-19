// RG-M04-14 — restitution : l'une des 4 conditions (payé, crédit, assurance, forçage).
import { formatFCFA } from "../money/format";

export interface CanDeliverInput {
  /** Reste à payer par le client (TTC) : solde de la facture émise, sinon total estimé client. */
  customerBalance: number;
  /** Facture émise couvrant l'OR (M08). */
  invoiceIssued: boolean;
  paymentTermsDays: number;
  /** `null` = illimité. */
  creditLimit: number | null;
  /** Encours actuel du client (hors cet OR). */
  outstanding: number;
  /** RG-M09-10 : OR ouvert sous blocage crédit → paiement comptant exigé. */
  cashOnly: boolean;
  creditHold: boolean;
  /** M16 : part assurance prise en charge, franchise et part client réglées. */
  insuranceSettled?: boolean;
  /** Motif de forçage + permission `repair_order:deliver_unpaid`. */
  forceUnpaidReason?: string | null;
  canForceUnpaid: boolean;
}

export type DeliveryBasis = "PAID" | "CREDIT" | "INSURANCE" | "FORCED";

export type CanDeliverResult =
  | { ok: true; basis: DeliveryBasis }
  | { ok: false; code: "UNPAID_BALANCE"; balance: number; message: string }
  | {
      ok: false;
      code: "CREDIT_LIMIT_EXCEEDED";
      outstanding: number;
      limit: number;
      message: string;
    };

export function canDeliver(input: CanDeliverInput): CanDeliverResult {
  if (input.customerBalance <= 0) return { ok: true, basis: "PAID" };
  if (input.insuranceSettled) return { ok: true, basis: "INSURANCE" };

  const onCredit = input.paymentTermsDays > 0 && !input.cashOnly && !input.creditHold;
  const exposure = input.outstanding + input.customerBalance;
  const withinLimit = input.creditLimit === null || exposure <= input.creditLimit;
  if (onCredit && withinLimit) return { ok: true, basis: "CREDIT" };

  const forceReason = input.forceUnpaidReason?.trim();
  if (forceReason && input.canForceUnpaid) return { ok: true, basis: "FORCED" };

  if (onCredit && !withinLimit && input.creditLimit !== null) {
    return {
      ok: false,
      code: "CREDIT_LIMIT_EXCEEDED",
      outstanding: exposure,
      limit: input.creditLimit,
      message: `Plafond de crédit dépassé : encours ${formatFCFA(exposure)} pour un plafond de ${formatFCFA(input.creditLimit)}. Encaissez ou demandez l'autorisation du gérant.`,
    };
  }
  return {
    ok: false,
    code: "UNPAID_BALANCE",
    balance: input.customerBalance,
    message: `Solde à régler : ${formatFCFA(input.customerBalance)}. Encaissez ou demandez l'autorisation du gérant.`,
  };
}
