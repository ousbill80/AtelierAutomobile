import type { PlanChangeRequest, PlanChangeResult, SubscriptionBillingProvider } from "./provider";

/** Fournisseur `fake` : paiement simulé, changement appliqué immédiatement (local et tests). */
export class FakeSubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = "fake" as const;
  readonly requests: PlanChangeRequest[] = [];

  async requestPlanChange(request: PlanChangeRequest): Promise<PlanChangeResult> {
    const existing = this.requests.find((r) => r.idempotencyKey === request.idempotencyKey);
    if (!existing) this.requests.push(request);
    return { status: "APPLIED", reference: `fake:${request.idempotencyKey}` };
  }
}
