// Libellés du module M07 (stock, achats) : source unique `apps/web/messages/fr.json`,
// namespace `stock`. `t("catalog.title")`, `t("reserve.reserved", { qty: "2" })`.
import { formatQty } from "@atelieros/core/inventory";
import messages from "../../../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };
const dict = messages.stock as unknown as Dict;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

/** dd/MM/yyyy depuis une date ISO (UTC). */
export function formatDay(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** dd/MM/yyyy HH:mm (heure d'Abidjan = UTC). */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : value.toISOString();
  return `${formatDay(iso)} ${iso.slice(11, 16)}`;
}

/** Quantité de base → texte avec unité : 45 (scale 10, litre) → « 4,5 litre ». */
export function qtyText(base: number, scale: number, unit?: string): string {
  const text = formatQty(base, scale);
  return unit ? `${text} ${unit}` : text;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const RESERVATION_TONE: Record<string, Tone> = {
  RESERVED: "ok",
  BACKORDERED: "warn",
  ISSUED: "off",
  RELEASED: "off",
};

export const PO_TONE: Record<string, Tone> = {
  DRAFT: "off",
  SENT: "warn",
  PARTIALLY_RECEIVED: "warn",
  RECEIVED: "ok",
  CANCELLED: "off",
};

export const COUNT_TONE: Record<string, Tone> = {
  DRAFT: "off",
  IN_PROGRESS: "warn",
  SUBMITTED: "warn",
  VALIDATED: "ok",
  CANCELLED: "off",
};

export const TRANSFER_TONE: Record<string, Tone> = {
  DRAFT: "off",
  IN_TRANSIT: "warn",
  RECEIVED: "ok",
  CANCELLED: "off",
};

/** Message d'une erreur tRPC (déjà en français côté serveur) ou libellé générique. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    if (message && !message.startsWith("[")) return message;
  }
  return t("common.error");
}
