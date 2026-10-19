// Libellés du module M05 (devis) : source unique `apps/web/messages/fr.json`, namespace `quotes`.
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

export type Tone = "ok" | "warn" | "bad" | "off";

export const QUOTE_STATUS_TONE: Record<string, Tone> = {
  DRAFT: "off",
  SENT: "warn",
  VIEWED: "warn",
  ACCEPTED: "ok",
  PARTIALLY_ACCEPTED: "ok",
  DECLINED: "bad",
  EXPIRED: "off",
  CONVERTED: "ok",
};

export const PRIORITY_TONE: Record<string, Tone> = { URGENT: "bad", WATCH: "warn" };
