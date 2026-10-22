// Libellés du module M18 (trésorerie) : source unique `apps/web/messages/fr.json`, namespace
// `treasury`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };

export function tt(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = messages.treasury as unknown as Dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}
