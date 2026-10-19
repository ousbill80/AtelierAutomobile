/**
 * M13 partie 2 — synchronisation par connexion directe à la base de l'ancien logiciel.
 * Fonctions pures : garde « lecture seule » des requêtes (RG-M13-25), paramètre `:since`
 * (RG-M13-26), planification (RG-M13-27) et correspondance des colonnes SQL vers les champs
 * cibles du pipeline d'import (les lignes SQL suivent ensuite exactement le même chemin
 * qu'un fichier : `buildAnalyzedRows` → `runImport`).
 */
import cronParser from "cron-parser";
import { DomainError } from "../errors";
import { matchColumn, normalizeHeader } from "./mapping";
import { SYNONYMS, type TargetField } from "./synonyms";

export type SqlDialect = "postgres" | "mysql" | "mssql" | "firebird";

/** RG-M13-25 : 50 000 lignes max par requête, 60 s de délai. */
export const SYNC_QUERY_MAX_ROWS = 50_000;
export const SYNC_QUERY_TIMEOUT_MS = 60_000;

/** RG-M13-17 : ordre d'application des entités d'une même synchro. */
export const SYNC_ENTITY_ORDER = ["customers", "vehicles", "invoices", "payments"] as const;
export type SyncEntity = (typeof SYNC_ENTITY_ORDER)[number];

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "EXEC",
  "EXECUTE",
  "MERGE",
  "GRANT",
  "REVOKE",
  "TRUNCATE",
  "CREATE",
  "CALL",
  "INTO",
  "REPLACE",
  "LOCK",
  "COPY",
] as const;

/**
 * Retire commentaires et littéraux (chaînes, identifiants entre guillemets / crochets) pour
 * que l'analyse ne porte que sur les mots-clés réellement exécutés.
 */
function stripLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    const closing = c === "'" ? "'" : c === '"' ? '"' : c === "`" ? "`" : c === "[" ? "]" : null;
    if (closing) {
      i++;
      while (i < sql.length) {
        if (sql[i] === closing) {
          // Guillemet doublé = échappement ('' ou "").
          if (sql[i + 1] === closing && closing !== "]") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      out += c === "'" ? " '' " : " x ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * RG-M13-25 — n'accepte qu'**une seule** instruction `SELECT` ou `WITH … SELECT`. Refuse tout
 * mot-clé d'écriture et tout `;` (sauf un unique `;` final). Lève une `DomainError` au
 * message actionnable.
 */
export function assertReadOnlySelect(sql: string): void {
  const cleaned = stripLiteralsAndComments(sql).trim().replace(/;\s*$/, "");
  if (cleaned === "") {
    throw new DomainError("sync.query_empty", "La requête est vide.");
  }
  if (cleaned.includes(";")) {
    throw new DomainError(
      "sync.query_multiple",
      "Une seule requête SELECT est autorisée (pas de « ; » au milieu).",
    );
  }
  const upper = cleaned.toUpperCase();
  if (!/^(SELECT|WITH)\b/.test(upper)) {
    throw new DomainError(
      "sync.query_not_select",
      "La requête doit commencer par SELECT ou WITH : la synchronisation est en lecture seule.",
    );
  }
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
      throw new DomainError(
        "sync.query_forbidden_keyword",
        `Mot-clé interdit dans une requête de synchronisation : ${keyword}. Seule la lecture est autorisée.`,
        { keyword },
      );
    }
  }
  if (/^WITH\b/.test(upper) && !/\bSELECT\b/.test(upper.replace(/^WITH\b/, ""))) {
    throw new DomainError(
      "sync.query_not_select",
      "La requête WITH doit se terminer par un SELECT.",
    );
  }
}

/**
 * RG-M13-26 — remplace `:since` (hors littéraux) par le paramètre du dialecte. Renvoie la
 * requête et le nombre d'occurrences, pour que l'appelant passe autant de paramètres que le
 * dialecte l'exige (`?` positionnel en MySQL / Firebird).
 */
export function bindSince(sql: string, dialect: SqlDialect): { sql: string; occurrences: number } {
  let occurrences = 0;
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql.startsWith(":since", i) && !/[A-Za-z0-9_]/.test(sql[i + 6] ?? "")) {
      occurrences++;
      out += dialect === "postgres" ? "$1" : dialect === "mssql" ? "@since" : "?";
      i += 6;
      continue;
    }
    out += c;
    i++;
  }
  return { sql: out, occurrences };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** RG-M13-26 : dernière synchro réussie − 1 jour de recouvrement ; première fois : tout. */
export function sinceFor(lastSuccessAt: Date | null): Date {
  return lastSuccessAt ? new Date(lastSuccessAt.getTime() - MS_PER_DAY) : new Date(0);
}

/** RG-M13-27 : planning par défaut, tous les jours à 02:00 heure locale. */
export const DEFAULT_SYNC_SCHEDULE = "0 2 * * *";
const MIN_INTERVAL_MS = 15 * 60 * 1000;

/** RG-M13-27 — cron valide et pas plus fréquent que toutes les 15 min. */
export function assertSyncSchedule(schedule: string, timeZone: string): void {
  let interval;
  try {
    interval = cronParser.parseExpression(schedule, {
      tz: timeZone,
      currentDate: new Date("2026-01-01T00:00:00Z"),
    });
  } catch {
    throw new DomainError("sync.schedule_invalid", `Planning invalide : « ${schedule} ».`);
  }
  let previous = interval.next().getTime();
  for (let k = 0; k < 96; k++) {
    const current = interval.next().getTime();
    if (current - previous < MIN_INTERVAL_MS) {
      throw new DomainError(
        "sync.schedule_too_frequent",
        "La synchronisation ne peut pas tourner plus souvent que toutes les 15 minutes.",
      );
    }
    previous = current;
  }
}

/**
 * RG-M13-27 — une source est due si une occurrence de son planning tombe dans
 * `]référence, now]`, la référence étant sa dernière exécution (ou sa création).
 */
export function isSyncDue(
  schedule: string | null,
  reference: Date,
  now: Date,
  timeZone: string,
): boolean {
  const interval = cronParser.parseExpression(schedule ?? DEFAULT_SYNC_SCHEDULE, {
    tz: timeZone,
    currentDate: reference,
  });
  return interval.next().getTime() <= now.getTime();
}

/** RG-M13-27 : notification OWNER au 3e échec consécutif (une seule fois). */
export function shouldNotifySyncFailure(consecutiveFailures: number): boolean {
  return consecutiveFailures === 3;
}

const ENTITY_PREFIX: Record<SyncEntity, string> = {
  customers: "customer",
  vehicles: "vehicle",
  invoices: "invoice",
  payments: "payment",
};

const ALL_FIELDS = Object.keys(SYNONYMS) as TargetField[];

/**
 * Colonnes d'une requête SQL → champs cibles. Ordre : nom exact d'un champ
 * (`customer.phone`) ; nom court du champ de l'entité de la requête (`total` dans la requête
 * `invoices` → `invoice.total`) ; nom court unique parmi tous les champs (`phone` →
 * `customer.phone`) ; synonymes RG-M13-06 (confiance ≥ 0,8). Sinon ignorée.
 */
export function mapSyncColumns(
  entity: SyncEntity,
  columns: readonly string[],
): Record<string, TargetField> {
  const result: Record<string, TargetField> = {};
  for (const column of columns) {
    const exact = ALL_FIELDS.find((f) => f === column);
    const sameEntity = ALL_FIELDS.find((f) => f === `${ENTITY_PREFIX[entity]}.${column}`);
    const shortMatches = ALL_FIELDS.filter((f) => f.split(".")[1] === column);
    const field =
      exact ??
      sameEntity ??
      (shortMatches.length === 1 ? shortMatches[0] : undefined) ??
      (() => {
        const match = matchColumn(normalizeHeader(column));
        return match && match.confidence >= 0.8 ? match.field : undefined;
      })();
    if (field) result[column] = field;
  }
  return result;
}
