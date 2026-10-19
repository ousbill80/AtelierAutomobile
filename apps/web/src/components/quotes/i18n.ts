// Libellés du module M05 (devis) : source unique `apps/web/messages/fr.json`, namespace
// `quotes`. `t("status.SENT")`, `t("card.expiresIn", { days: 3 })`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };
const dict = messages.quotes as unknown as Dict;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export const DEFAULT_TIME_ZONE = "Africa/Abidjan";

export function formatDay(value: Date | string | null | undefined, timeZone = DEFAULT_TIME_ZONE) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!value) return "—";
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatDay(date, timeZone)} ${time}`;
}

/** `Date` (minuit UTC, @db.Date) → valeur `input[type=date]`. */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "off",
  SENT: "warn",
  VIEWED: "warn",
  ACCEPTED: "ok",
  PARTIALLY_ACCEPTED: "ok",
  DECLINED: "bad",
  EXPIRED: "off",
  CONVERTED: "ok",
};

export const PRIORITY_TONE: Record<string, Tone> = {
  URGENT: "bad",
  WATCH: "warn",
  NONE: "off",
};

export const DISCOUNT_APPROVAL_TONE: Record<string, Tone> = {
  PENDING: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
};
