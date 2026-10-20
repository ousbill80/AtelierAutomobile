import type { PlanChangeRequest, PlanChangeResult, SubscriptionBillingProvider } from "./provider";

/**
 * Fournisseur `manual` (défaut, production v1) : la demande est transmise à l'équipe
 * commerciale par `notify` (email interne, ticket…), le plan n'est pas modifié ici. L'équipe
 * applique ensuite le changement (et d'éventuelles surcharges `planOverrides`) côté support.
 */
export class ManualSubscriptionProvider implements SubscriptionBillingProvider {
  readonly name = "manual" as const;

  constructor(
    private readonly notify: (request: PlanChangeRequest) => Promise<void> = async () => {},
  ) {}

  async requestPlanChange(request: PlanChangeRequest): Promise<PlanChangeResult> {
    await this.notify(request);
    return { status: "PENDING", reference: `manual:${request.idempotencyKey}` };
  }
}
