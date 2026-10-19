// Libellés du module M04 (ordres de réparation) : source unique `apps/web/messages/fr.json`,
// namespace `repairOrders`. `t("status.READY")`, `t("counters.late", { count: 2 })`.
import messages from "../../../messages/fr.json";

type Dict = { [key: string]: string | Dict };
const dict = messages.repairOrders as unknown as Dict;

export function t(key: string, vars?: Record<string, string | number>): string {
  let node: string | Dict | undefined = dict;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return vars ? node.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : node;
}

export const DEFAULT_TIME_ZONE = "Africa/Abidjan";

/** `dd/MM/yyyy` dans le fuseau de l'organisation (CLAUDE.md). */
export function formatDay(value: Date | string | null | undefined, timeZone = DEFAULT_TIME_ZONE) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/** `dd/MM/yyyy HH:mm` dans le fuseau de l'organisation. */
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

/** Valeur `datetime-local` (heure locale de l'organisation) ↔ Date UTC. */
export function toLocalInput(
  value: Date | string | null | undefined,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
  return parts.replace(" ", "T");
}

export function fromLocalInput(value: string, timeZone = DEFAULT_TIME_ZONE): Date | undefined {
  if (!value) return undefined;
  const asUtc = new Date(`${value}:00.000Z`);
  // Décalage du fuseau à cet instant (Abidjan = UTC+0).
  const local = new Date(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .format(asUtc)
      .replace(" ", "T") + ".000Z",
  );
  return new Date(asUtc.getTime() - (local.getTime() - asUtc.getTime()));
}

export type Tone = "ok" | "warn" | "bad" | "off";

export const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "off",
  CHECKED_IN: "off",
  DIAGNOSING: "warn",
  AWAITING_APPROVAL: "warn",
  APPROVED: "ok",
  IN_PROGRESS: "ok",
  WAITING_PARTS: "bad",
  QUALITY_CHECK: "warn",
  READY: "ok",
  DELIVERED: "off",
  INVOICED: "off",
  CANCELLED: "off",
};

export const APPROVAL_TONE: Record<string, Tone> = {
  NOT_REQUIRED: "off",
  PENDING: "warn",
  APPROVED: "ok",
  DECLINED: "bad",
};

export const INSPECTION_TONE: Record<string, Tone> = {
  OK: "ok",
  WATCH: "warn",
  URGENT: "bad",
  NOT_CHECKED: "off",
};
