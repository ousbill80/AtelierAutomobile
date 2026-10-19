// Libellés du module M08 (factures, caisse) : source unique `apps/web/messages/fr.json`,
// namespaces `billing` et `cash`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };

function lookup(dict: Dict, key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return lookup(messages.billing as unknown as Dict, key, vars);
}

export function tc(key: string, vars?: Record<string, string | number>): string {
  return lookup(messages.cash as unknown as Dict, key, vars);
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const INVOICE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "off",
  ISSUED: "warn",
  PARTIALLY_PAID: "warn",
  PAID: "ok",
  OVERDUE: "bad",
  VOID: "off",
  WRITTEN_OFF: "off",
  DISPUTED: "bad",
};

export const FNE_TONE: Record<string, Tone> = {
  NOT_REQUIRED: "off",
  PENDING: "warn",
  CERTIFIED: "ok",
  FAILED: "bad",
  MANUAL: "ok",
};

export const PAYMENT_METHODS = [
  "CASH",
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const REFERENCE_REQUIRED: ReadonlySet<string> = new Set([
  "WAVE",
  "ORANGE_MONEY",
  "MTN_MOMO",
  "MOOV_MONEY",
  "CHEQUE",
  "BANK_TRANSFER",
]);
