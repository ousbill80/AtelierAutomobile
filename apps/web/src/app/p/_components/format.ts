// M14 — formats légers pour les composants client du portail (sans dépendance lourde).
const TIME_ZONE = "Africa/Abidjan";

/** Remplace `{clé}` par sa valeur. */
export function tpl(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** `dd/MM/yyyy` dans le fuseau de l'organisation. */
export function fmtDay(value: Date | string | null | undefined, timeZone = TIME_ZONE): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

/** Date métier `@db.Date` (minuit UTC) : affichée sans conversion de fuseau. */
export function fmtBusinessDay(value: Date | string | null | undefined): string {
  return fmtDay(value, "UTC");
}

export function fmtDateTime(value: Date | string | null | undefined, timeZone = TIME_ZONE): string {
  if (!value) return "—";
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${fmtDay(date, timeZone)} ${time}`;
}

export function fmtTime(value: Date | string, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

/** `185 000 FCFA` (entiers FCFA, `core/money`). */
export { formatFCFA as fmtFCFA } from "@atelieros/core/money";

export function fmtKm(km: number): string {
  return km.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export type Messages = { [key: string]: string | Messages };

/**
 * Traducteur sur un sous-ensemble de fr.json passé en props par la page serveur (le fichier
 * complet n'est pas embarqué dans le JavaScript du portail, RG-M14-24).
 */
export function makeT(dict: Messages) {
  return (key: string, vars?: Record<string, string | number>): string => {
    let node: string | Messages | undefined = dict;
    for (const part of key.split(".")) {
      node = typeof node === "object" ? node[part] : undefined;
    }
    if (typeof node !== "string") return key;
    return vars ? tpl(node, vars) : node;
  };
}
