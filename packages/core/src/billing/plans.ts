// M15 RG-M15-19 / arbitrage A12 — catalogue des plans. Hypothèses commerciales centralisées ici :
// tout le reste du code (limites, crédits IA, jauges) lit ce fichier, jamais une valeur en dur.

export const PLAN_TIERS = ["STARTER", "PRO", "NETWORK"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Limites dénombrables : `null` = illimité. */
export interface PlanQuotas {
  /** Utilisateurs actifs (RG-M01-13). */
  activeMembers: number | null;
  /** Sites actifs. */
  activeSites: number | null;
  /** Messages automatiques (relances) par mois. */
  autoMessagesPerMonth: number | null;
  /** Crédits IA par mois (M17). */
  aiCreditsPerMonth: number | null;
  /** Stockage fichiers, en octets. */
  storageBytes: number | null;
  /** Sources de synchronisation actives (M13). */
  dataSources: number | null;
  /** Clés API actives (non révoquées). */
  apiKeys: number | null;
  /** Requêtes API par minute. */
  apiRatePerMinute: number;
  /** Profondeur du journal d'audit consultable, en jours. */
  auditRetentionDays: number;
}

/** Fonctions incluses ou non selon le plan. */
export interface PlanFeatures {
  /** API publique : "read" (lecture seule) ou "full". */
  publicApi: "read" | "full";
  /** Comparaison multi-sites, transferts de stock. */
  multiSite: boolean;
  /** Portail client : "basic" (devis + facture) ou "full". */
  portal: "basic" | "full";
  /** Assistant IA conversationnel. */
  aiAssistant: boolean;
  /** Types de sources de synchro autorisés (M13). */
  dataSourceTypes: "files" | "all";
}

export interface PlanDefinition {
  tier: PlanTier;
  quotas: PlanQuotas;
  features: PlanFeatures;
}

const GB = 1024 * 1024 * 1024;

export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  STARTER: {
    tier: "STARTER",
    quotas: {
      activeMembers: 5,
      activeSites: 1,
      autoMessagesPerMonth: 1_000,
      aiCreditsPerMonth: 500,
      storageBytes: 5 * GB,
      dataSources: 1,
      apiKeys: 2,
      apiRatePerMinute: 60,
      auditRetentionDays: 90,
    },
    features: {
      publicApi: "read",
      multiSite: false,
      portal: "basic",
      aiAssistant: false,
      dataSourceTypes: "files",
    },
  },
  PRO: {
    tier: "PRO",
    quotas: {
      activeMembers: 15,
      activeSites: 3,
      autoMessagesPerMonth: 5_000,
      aiCreditsPerMonth: 3_000,
      storageBytes: 25 * GB,
      dataSources: 3,
      apiKeys: 10,
      apiRatePerMinute: 300,
      auditRetentionDays: 365,
    },
    features: {
      publicApi: "full",
      multiSite: false,
      portal: "full",
      aiAssistant: true,
      dataSourceTypes: "all",
    },
  },
  NETWORK: {
    tier: "NETWORK",
    quotas: {
      activeMembers: null,
      activeSites: null,
      autoMessagesPerMonth: 20_000,
      aiCreditsPerMonth: 10_000,
      storageBytes: 100 * GB,
      dataSources: null,
      apiKeys: null,
      apiRatePerMinute: 1_200,
      auditRetentionDays: 3 * 365,
    },
    features: {
      publicApi: "full",
      multiSite: true,
      portal: "full",
      aiAssistant: true,
      dataSourceTypes: "all",
    },
  },
};

export function isPlanTier(value: unknown): value is PlanTier {
  return typeof value === "string" && (PLAN_TIERS as readonly string[]).includes(value);
}

/** Rang d'un plan (STARTER < PRO < NETWORK), pour distinguer montée et rétrogradation. */
export function planRank(tier: PlanTier): number {
  return PLAN_TIERS.indexOf(tier);
}

/**
 * Surcharges par organisation (`Organization.planOverrides`, posées par l'équipe AtelierOS) :
 * seules les clés de quotas connues, numériques entières ≥ 0 ou `null` (illimité), sont prises
 * en compte ; tout le reste est ignoré pour qu'un JSON mal formé ne puisse rien débloquer.
 */
export function parsePlanOverrides(raw: unknown): Partial<PlanQuotas> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const keys = Object.keys(PLAN_CATALOG.STARTER.quotas) as (keyof PlanQuotas)[];
  const result: Partial<Record<keyof PlanQuotas, number | null>> = {};
  for (const key of keys) {
    if (!(key in raw)) continue;
    const value = (raw as Record<string, unknown>)[key];
    const nullable = key !== "apiRatePerMinute" && key !== "auditRetentionDays";
    if (value === null && nullable) {
      result[key] = null;
    } else if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      result[key] = value;
    }
  }
  return result as Partial<PlanQuotas>;
}

/** Plan effectif : catalogue + surcharges de l'organisation. */
export function resolvePlan(tier: PlanTier, overrides?: unknown): PlanDefinition {
  const base = PLAN_CATALOG[tier];
  return {
    tier,
    quotas: { ...base.quotas, ...parsePlanOverrides(overrides) },
    features: base.features,
  };
}
