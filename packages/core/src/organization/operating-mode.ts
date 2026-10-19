import { DomainError } from "../errors";

// RG-M15-23 — mode de fonctionnement du garage : FULL (tout) ou REMINDERS_ONLY (garage qui
// garde son ancien logiciel métier et n'utilise AtelierOS que pour les relances/créances).

export type OperatingMode = "FULL" | "REMINDERS_ONLY";

/** Clés des modules dont la visibilité dépend du mode de fonctionnement (menu, routes). */
export const MODULE_KEYS = [
  "dashboard",
  "reminders",
  "receivables",
  "customers",
  "vehicles",
  "deadlines",
  "messages",
  "import",
  "settings",
  "appointments",
  "repair_orders",
  "quotes",
  "workshop",
  "stock",
  "purchasing",
  "cash",
  "invoicing",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * US-M15-10 — en `REMINDERS_ONLY`, le menu ne montre que : Tableau de bord, Relances,
 * Créances, Clients & véhicules, Échéances, Messages, Import, Paramètres.
 */
export const REMINDERS_ONLY_VISIBLE_MODULES: ReadonlySet<ModuleKey> = new Set([
  "dashboard",
  "reminders",
  "receivables",
  "customers",
  "vehicles",
  "deadlines",
  "messages",
  "import",
  "settings",
]);

/** RG-M15-23 — vrai si le module doit être visible/accessible dans ce mode. */
export function isModuleVisible(mode: OperatingMode, moduleKey: ModuleKey): boolean {
  if (mode === "FULL") {
    return true;
  }
  return REMINDERS_ONLY_VISIBLE_MODULES.has(moduleKey);
}

/** RG-M15-23 — lève si le module demandé est masqué par le mode courant. */
export function assertModuleAllowed(mode: OperatingMode, moduleKey: ModuleKey): void {
  if (!isModuleVisible(mode, moduleKey)) {
    throw new DomainError(
      "operating_mode.module_hidden",
      "Cette fonction est disponible en gestion complète.",
      { mode, moduleKey },
    );
  }
}

export interface CanSwitchOperatingModeInput {
  from: OperatingMode;
  to: OperatingMode;
  /** Vrai si une `DataSource` (M13) est active pour l'organisation. */
  hasActiveDataSource: boolean;
}

export interface OperatingModeSwitchResult {
  allowed: boolean;
  /** Raison en français si le passage est refusé. */
  reason?: string;
}

/**
 * RG-M15-23 — le passage en `REMINDERS_ONLY` est toujours permis (aucune précondition).
 * Le passage en `FULL` est direct si aucune source de synchro M13 n'est active ; sinon il
 * doit passer par l'assistant de migration M13 (RG-M13-43, non disponible dans cette étape).
 */
export function canSwitchOperatingMode(
  input: CanSwitchOperatingModeInput,
): OperatingModeSwitchResult {
  const { from, to, hasActiveDataSource } = input;

  if (from === to) {
    return { allowed: true };
  }

  if (to === "REMINDERS_ONLY") {
    return { allowed: true };
  }

  // to === "FULL"
  if (!hasActiveDataSource) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      "Une source de synchronisation est active. Utilisez l'assistant de migration (Paramètres > Import) pour repasser en gestion complète.",
  };
}
