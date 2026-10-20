// Libellés du lot M17 « devis » : source unique `apps/web/messages/fr.json`, namespace `aiQuotes`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };
const dict = messages.aiQuotes as unknown as Dict;

export function tAi(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}
