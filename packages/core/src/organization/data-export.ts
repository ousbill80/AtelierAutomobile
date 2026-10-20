// M15 RG-M15-21 / US-M15-08 — export complet des données de l'organisation. Fonctions pures :
// sérialisation CSV, filtrage des colonnes sensibles, cadence et expiration. La collecte des
// lignes (db.forTenant) et l'écriture de l'archive sont faites par la tâche `org.export`.

import { DomainError } from "../errors";

/** Validité du lien de téléchargement. */
export const EXPORT_LINK_VALIDITY_HOURS = 48;
/** Un export par 24 h et par organisation. */
export const EXPORT_MIN_INTERVAL_HOURS = 24;
/** BOM UTF-8 : Excel (réglages français) ouvre alors le fichier sans casser les accents. */
export const CSV_BOM = "\uFEFF";
export const CSV_SEPARATOR = ";";

/**
 * Colonnes jamais exportées : secrets fournisseurs (`credentials`, `config` chiffré des
 * sources M13), empreintes de mots de passe/PIN/jetons/clés. Comparaison insensible à la casse
 * sur le nom de colonne complet ou son suffixe.
 */
const SENSITIVE_EXACT = new Set([
  "credentials",
  "config",
  "password",
  "passwordhash",
  "pinhash",
  "keyhash",
  "tokenhash",
  "token",
  "secret",
  "apikey",
  "webhookverifytoken",
]);
const SENSITIVE_SUFFIXES = ["hash", "secret", "token", "apikey", "password"];

export function isSensitiveColumn(column: string): boolean {
  const lower = column.toLowerCase();
  if (SENSITIVE_EXACT.has(lower)) return true;
  return SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** Tables dont l'export n'a pas de sens ou serait dangereux (journal technique, jetons). */
export const EXPORT_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  "PortalToken",
  "TrustedDevice",
  "DataExport",
  "DomainEvent",
  "TechSyncOperation",
  "PaymentWebhookLog",
  "ApiKey",
]);

export function shouldExportTable(model: string): boolean {
  return !EXPORT_EXCLUDED_TABLES.has(model);
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    // Decimal Prisma (toFixed) ou Buffer : représentation textuelle ; JSON sinon.
    if ("toFixed" in value && typeof (value as { toString: unknown }).toString === "function") {
      return String(value);
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function csvCell(value: unknown): string {
  const text = cellToText(value);
  if (/[";\r\n]/.test(text) || /^\s|\s$/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  // Neutralise l'injection de formule dans un tableur (=, +, -, @ en tête).
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) {
    return `"'${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Colonnes exportables d'une table, dans l'ordre du schéma, sans les colonnes sensibles. */
export function exportableColumns(columns: readonly string[]): string[] {
  return columns.filter((column) => !isSensitiveColumn(column));
}

/** En-tête CSV (avec BOM) : à écrire une seule fois, avant les lignes. */
export function csvHeader(columns: readonly string[]): string {
  return `${CSV_BOM}${columns.map(csvCell).join(CSV_SEPARATOR)}\r\n`;
}

/** Lignes CSV (séparateur `;`, fin de ligne CRLF) ; les colonnes absentes sont vides. */
export function csvRows(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  let out = "";
  for (const row of rows) {
    out += `${columns.map((column) => csvCell(row[column])).join(CSV_SEPARATOR)}\r\n`;
  }
  return out;
}

export function exportToCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  return csvHeader(columns) + csvRows(columns, rows);
}

/** Nom de fichier d'une table : `RepairOrder` → `repair_order.csv`. */
export function tableFileName(model: string): string {
  return `${model.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}.csv`;
}

export interface ExportCadenceInput {
  /** Exports de l'organisation encore valides (non FAILED), du plus récent au plus ancien. */
  previous: { createdAt: Date; status: string }[];
  now: Date;
}

/** RG-M15-21 — au plus un export par 24 h (un export échoué ne compte pas). */
export function assertExportAllowed(input: ExportCadenceInput): void {
  const windowStart = input.now.getTime() - EXPORT_MIN_INTERVAL_HOURS * 3_600_000;
  const recent = input.previous.find(
    (e) => e.status !== "FAILED" && e.createdAt.getTime() > windowStart,
  );
  if (recent) {
    const next = new Date(recent.createdAt.getTime() + EXPORT_MIN_INTERVAL_HOURS * 3_600_000);
    throw new DomainError(
      "export.too_frequent",
      "Un export a déjà été demandé il y a moins de 24 h. Réessayez plus tard ou téléchargez l'archive déjà préparée.",
      { nextAllowedAt: next.toISOString() },
    );
  }
}

export function exportExpiry(readyAt: Date): Date {
  return new Date(readyAt.getTime() + EXPORT_LINK_VALIDITY_HOURS * 3_600_000);
}

export function isExportExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

export interface ReadmeInput {
  organizationName: string;
  generatedAt: string;
  tables: { file: string; rows: number }[];
  photoCount: number;
  documentCount: number;
}

/** Contenu de `LISEZMOI.txt` placé à la racine de l'archive. */
export function exportReadme(input: ReadmeInput): string {
  const lines = [
    `Export complet des données — ${input.organizationName}`,
    `Généré le ${input.generatedAt} par AtelierOS.`,
    "",
    "Contenu :",
    "- un fichier CSV par table (UTF-8 avec BOM, séparateur « ; », dates en UTC au format ISO 8601,",
    "  montants en francs CFA entiers) ;",
    `- photos/ : ${input.photoCount} fichier(s) joint(s) (photos d'OR, signatures, pièces de sinistre) ;`,
    `- documents/ : ${input.documentCount} facture(s) émise(s) en PDF.`,
    "",
    "Ne sont jamais exportés : mots de passe, codes PIN, jetons, clés API et identifiants des",
    "fournisseurs (WhatsApp, SMS, paiement, FNE), qui restent chiffrés dans AtelierOS.",
    "",
    "Tables :",
    ...input.tables.map((t) => `- ${t.file} : ${t.rows} ligne(s)`),
    "",
  ];
  return lines.join("\r\n");
}
