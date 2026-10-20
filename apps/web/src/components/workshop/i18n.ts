// Libellés M06 : source unique `apps/web/messages/fr.json`, namespaces `workshop` (bureau) et
// `tablet` (PWA mécanicien).
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

export const tw = (key: string, vars?: Record<string, string | number>) =>
  lookup(messages.workshop as unknown as Dict, key, vars);

export const tt = (key: string, vars?: Record<string, string | number>) =>
  lookup(messages.tablet as unknown as Dict, key, vars);

/** Durée lisible : « 45 min », « 2 h », « 1 h 30 », « 1 j 3 h ». */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return tw("duration.minutes", { m });
  const h = Math.floor(m / 60);
  if (h >= 24) return tw("duration.days", { d: Math.floor(h / 24), h: h % 24 });
  const rest = m % 60;
  return rest === 0
    ? tw("duration.hours", { h })
    : tw("duration.hoursMinutes", { h, m: String(rest).padStart(2, "0") });
}

/** Heure `HH:mm` dans le fuseau de l'organisation. */
export function formatTime(value: Date | string | null | undefined, timeZone = "Africa/Abidjan") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Initiales « KY » pour « Konan Yao ». */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/** Téléchargement CSV (séparateur « ; », BOM UTF-8 pour Excel). */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const escape = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + rows.map((r) => r.map(escape).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
