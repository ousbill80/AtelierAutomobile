// Libellés du module M09 (créances) : source unique `apps/web/messages/fr.json`, namespace
// `receivables`. `t("aging.b0_30")`, `t("days", { count: 12 })`.
import messages from "../../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };
const dict = messages.receivables as unknown as Dict;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export function formatDay(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const CASE_STATUS_TONE: Record<string, Tone> = {
  OPEN: "warn",
  PROMISED: "ok",
  PAUSED: "off",
  DISPUTED: "bad",
  ESCALATED: "bad",
  CLOSED_PAID: "ok",
  CLOSED_WRITTEN_OFF: "off",
};

export const INVOICE_STATUS_TONE: Record<string, Tone> = {
  ISSUED: "off",
  PARTIALLY_PAID: "warn",
  OVERDUE: "bad",
  DISPUTED: "bad",
  WRITTEN_OFF: "off",
  PAID: "ok",
};

export function riskLabelOf(score: number | null | undefined): { key: string; tone: Tone } {
  if (score === null || score === undefined) return { key: "risk.none", tone: "off" };
  if (score < 25) return { key: "risk.GOOD", tone: "ok" };
  if (score < 50) return { key: "risk.WATCH", tone: "warn" };
  if (score < 75) return { key: "risk.RISKY", tone: "bad" };
  return { key: "risk.VERY_RISKY", tone: "bad" };
}

export const BUCKETS = ["notDue", "b0_30", "b31_60", "b61_90", "b90p"] as const;
export type Bucket = (typeof BUCKETS)[number];
