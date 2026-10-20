// M17 — catalogue des fonctions IA, activation (RG-M17-10), plans et quotas (RG-M17-07),
// timeouts (RG-M17-08). Valeurs commerciales centralisées ici (A12).

import { PLAN_CATALOG } from "../billing/plans";

export const AI_FEATURES = [
  "intent_classification",
  "reply_draft",
  "slot_suggestion",
  "quote_draft",
  "quote_explanation",
  "column_mapping",
  "document_extraction",
  "assistant",
  "daily_digest",
  "anomaly_label",
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** Fonctions « de fond » : poursuivies en repli sans IA quand le quota est atteint (RG-M17-07). */
export const BACKGROUND_FEATURES: ReadonlySet<AiFeature> = new Set([
  "intent_classification",
  "daily_digest",
  "anomaly_label",
]);

/** RG-M17-08 — timeout par fonction (ms). */
export const AI_TIMEOUT_MS: Record<AiFeature, number> = {
  intent_classification: 8_000,
  reply_draft: 15_000,
  slot_suggestion: 8_000,
  quote_draft: 30_000,
  quote_explanation: 15_000,
  column_mapping: 15_000,
  document_extraction: 30_000,
  assistant: 45_000,
  daily_digest: 15_000,
  anomaly_label: 8_000,
};

/** Fonctions qui utilisent le modèle léger (`AI_MODEL_FAST`) quand il est configuré. */
export const FAST_MODEL_FEATURES: ReadonlySet<AiFeature> = new Set([
  "intent_classification",
  "slot_suggestion",
  "column_mapping",
  "anomaly_label",
]);

export type PlanTierLike = "STARTER" | "PRO" | "NETWORK";

/** M15 RG-M15-19 / A12 — crédits IA par mois. */
export const AI_CREDITS_BY_PLAN: Record<PlanTierLike, number> = {
  STARTER: PLAN_CATALOG.STARTER.quotas.aiCreditsPerMonth ?? 0,
  PRO: PLAN_CATALOG.PRO.quotas.aiCreditsPerMonth ?? 0,
  NETWORK: PLAN_CATALOG.NETWORK.quotas.aiCreditsPerMonth ?? 0,
};

/** RG-M17-07 — plafond par utilisateur et par jour (assistant). */
export const AI_USER_DAILY_CAP = 200;

const STARTER_FEATURES: ReadonlySet<AiFeature> = new Set([
  "intent_classification",
  "reply_draft",
  "slot_suggestion",
  "column_mapping",
  "document_extraction",
  "quote_explanation",
]);

/** RG-M17-07 — fonctions autorisées par plan (STARTER restreint, PRO/NETWORK = toutes). */
export function isFeatureInPlan(plan: PlanTierLike, feature: AiFeature): boolean {
  return plan === "STARTER" ? STARTER_FEATURES.has(feature) : true;
}

/** RG-M17-07 — crédits = ceil((tokensIn + 4 × tokensOut) / 1 000), minimum 1 par appel. */
export function creditsFor(tokensIn: number, tokensOut: number): number {
  const raw = Math.ceil((Math.max(0, tokensIn) + 4 * Math.max(0, tokensOut)) / 1000);
  return Math.max(1, raw);
}

// ── Réglages `settings.ai` (RG-M17-10) ──

export interface AiSettings {
  enabled: boolean;
  features: Record<AiFeature, boolean>;
  autoTimeOptimization: boolean;
  assistantEnabled: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  features: Object.fromEntries(AI_FEATURES.map((f) => [f, true])) as Record<AiFeature, boolean>,
  autoTimeOptimization: true,
  assistantEnabled: true,
};

/** Fusionne `Organization.settings.ai` (partiel, éventuellement invalide) avec les défauts. */
export function resolveAiSettings(settings: unknown): AiSettings {
  const raw =
    settings && typeof settings === "object" && "ai" in settings
      ? (settings as { ai?: unknown }).ai
      : undefined;
  const ai = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const features = { ...DEFAULT_AI_SETTINGS.features };
  if (ai.features && typeof ai.features === "object") {
    for (const [key, value] of Object.entries(ai.features as Record<string, unknown>)) {
      if ((AI_FEATURES as readonly string[]).includes(key) && typeof value === "boolean") {
        features[key as AiFeature] = value;
      }
    }
  }
  const bool = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;
  return {
    enabled: bool(ai.enabled, DEFAULT_AI_SETTINGS.enabled),
    features,
    autoTimeOptimization: bool(ai.autoTimeOptimization, DEFAULT_AI_SETTINGS.autoTimeOptimization),
    assistantEnabled: bool(ai.assistantEnabled, DEFAULT_AI_SETTINGS.assistantEnabled),
  };
}

export type AiGateDecision =
  { allowed: true } | { allowed: false; status: "DISABLED" | "QUOTA_EXCEEDED"; reason: string };

export interface AiGateInput {
  feature: AiFeature;
  plan: PlanTierLike;
  settings: AiSettings;
  /** Crédits consommés par l'organisation ce mois-ci (fuseau de l'organisation). */
  creditsUsedThisMonth: number;
  /** Crédits consommés aujourd'hui par l'utilisateur (assistant uniquement). */
  userCreditsToday?: number;
}

/**
 * RG-M17-07 / RG-M17-10 — l'appel au modèle est-il permis ? Un refus n'empêche pas le repli
 * sans IA : l'appelant l'applique (fonctions de fond) ou affiche le motif (à la demande).
 */
export function gateAiCall(input: AiGateInput): AiGateDecision {
  const { feature, settings } = input;
  if (!settings.enabled || !settings.features[feature]) {
    return { allowed: false, status: "DISABLED", reason: "Fonction IA désactivée." };
  }
  if (feature === "assistant" && !settings.assistantEnabled) {
    return { allowed: false, status: "DISABLED", reason: "Assistant désactivé." };
  }
  if (!isFeatureInPlan(input.plan, feature)) {
    return {
      allowed: false,
      status: "DISABLED",
      reason: `Fonction non incluse dans l'offre ${input.plan}.`,
    };
  }
  if (input.creditsUsedThisMonth >= AI_CREDITS_BY_PLAN[input.plan]) {
    return { allowed: false, status: "QUOTA_EXCEEDED", reason: "Quota IA du mois atteint." };
  }
  if (feature === "assistant" && (input.userCreditsToday ?? 0) >= AI_USER_DAILY_CAP) {
    return {
      allowed: false,
      status: "QUOTA_EXCEEDED",
      reason: "Plafond quotidien de l'assistant atteint.",
    };
  }
  return { allowed: true };
}

/** Début du mois civil courant dans le fuseau de l'organisation, en UTC. */
export function monthStartUtc(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const guess = Date.UTC(year, month - 1, 1);
  // Décalage du fuseau au 1er du mois (Abidjan = UTC, mais rester correct ailleurs).
  const local = new Date(new Date(guess).toLocaleString("en-US", { timeZone }));
  const utc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - (local.getTime() - utc.getTime()));
}

/** Expiration d'une suggestion (§5 : 48 h). */
export const AI_SUGGESTION_TTL_MS = 48 * 60 * 60 * 1000;
