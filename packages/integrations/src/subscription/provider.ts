import type { PlanTier } from "@atelieros/core";

// M15 US-M15-07 / RG-M15-19 — facturation de l'abonnement AtelierOS (pas celle des clients du
// garage). v1 : aucun paiement en ligne de l'abonnement ; un changement d'offre est une demande
// traitée par l'équipe commerciale (`manual`). `fake` applique immédiatement le changement
// (paiement simulé) pour le développement local et les tests — interdit en production.

export type SubscriptionProviderName = "manual" | "fake";

export interface PlanChangeRequest {
  organizationId: string;
  organizationName: string;
  currentPlan: PlanTier;
  targetPlan: PlanTier;
  requestedBy: { name: string; email?: string | null; phone?: string | null };
  message?: string | null;
  /** Clé d'idempotence : deux appels identiques ne créent qu'une demande chez le fournisseur. */
  idempotencyKey: string;
}

export interface PlanChangeResult {
  /** APPLIED : le plan peut être changé tout de suite ; PENDING : à traiter par l'équipe AtelierOS. */
  status: "APPLIED" | "PENDING";
  /** Référence de la demande chez le fournisseur (affichée et journalisée). */
  reference: string;
}

export interface SubscriptionBillingProvider {
  readonly name: SubscriptionProviderName;
  requestPlanChange(request: PlanChangeRequest): Promise<PlanChangeResult>;
}
