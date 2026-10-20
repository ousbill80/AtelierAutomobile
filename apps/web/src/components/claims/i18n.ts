// Libellés du module M16 (assurances et sinistres) : source unique `apps/web/messages/fr.json`,
// namespace `claims`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = messages.claims as unknown as Dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const CLAIM_STATUSES = [
  "OPENED",
  "EXPERT_SCHEDULED",
  "ESTIMATE_SENT",
  "APPROVED",
  "REPAIRING",
  "INVOICED",
  "PARTIALLY_PAID",
  "PAID",
  "REJECTED",
  "CANCELLED",
] as const;

export const CLAIM_STATUS_TONE: Record<string, Tone> = {
  OPENED: "off",
  EXPERT_SCHEDULED: "warn",
  ESTIMATE_SENT: "warn",
  APPROVED: "ok",
  REPAIRING: "ok",
  INVOICED: "warn",
  PARTIALLY_PAID: "warn",
  PAID: "ok",
  REJECTED: "bad",
  CANCELLED: "off",
};

export const CLAIM_STATUS_ICON: Record<string, string> = {
  OPENED: "○",
  EXPERT_SCHEDULED: "🕑",
  ESTIMATE_SENT: "✉",
  APPROVED: "✓",
  REPAIRING: "🔧",
  INVOICED: "🧾",
  PARTIALLY_PAID: "◐",
  PAID: "✓",
  REJECTED: "✕",
  CANCELLED: "—",
};

export const ATTACHMENT_KINDS = [
  "claim_report",
  "photo_damage",
  "photo_repair",
  "expert_report",
  "approval_letter",
  "registration",
  "insurance_certificate",
  "driver_license",
  "police_report",
  "invoice_supplier",
  "other",
] as const;
