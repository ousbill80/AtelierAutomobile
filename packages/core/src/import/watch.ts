/**
 * M13 partie 2 — dossier surveillé de l'agent local (RG-M13-29) : motif de nom
 * configurable, fichier pris seulement s'il est stable depuis 60 s, rangement dans
 * `traites/AAAA-MM-JJ/` ou `erreurs/`. Un fichier déjà traité (même sha256) est ignoré.
 */
import type { SyncEntity } from "./sync";

export const WATCH_STABLE_MS = 60_000;
export const WATCH_MAX_RULES = 20;

export interface WatchRule {
  /** Motif de nom, `*` et `?` (insensible à la casse) : « clients*.csv ». */
  pattern: string;
  entity: SyncEntity;
}

/** `*` = n'importe quelle suite, `?` = un caractère ; insensible à la casse. */
export function matchesFilePattern(fileName: string, pattern: string): boolean {
  const regex = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`, "i").test(fileName);
}

/** Première règle dont le motif correspond au fichier, sinon `null` (fichier ignoré). */
export function ruleForFile(fileName: string, rules: readonly WatchRule[]): WatchRule | null {
  return rules.find((r) => matchesFilePattern(fileName, r.pattern)) ?? null;
}

/** Un fichier encore en cours d'écriture par l'ancien logiciel n'est pas lu. */
export function isFileStable(modifiedAt: Date, now: Date): boolean {
  return now.getTime() - modifiedAt.getTime() >= WATCH_STABLE_MS;
}

/** Sous-dossier de rangement d'un fichier traité : `traites/2026-10-19`. */
export function processedFolder(localDay: string): string {
  return `traites/${localDay}`;
}

export const ERROR_FOLDER = "erreurs";
