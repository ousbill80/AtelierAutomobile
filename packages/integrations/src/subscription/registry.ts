import { DomainError } from "@atelieros/core";
import { FakeSubscriptionProvider } from "./fake";
import { ManualSubscriptionProvider } from "./manual";
import type { PlanChangeRequest, SubscriptionBillingProvider } from "./provider";

export interface SubscriptionRegistryDeps {
  /** `SUBSCRIPTION_BILLING_PROVIDER` : "manual" (défaut) ou "fake". */
  provider?: string | null;
  /** `false` en production : le simulateur n'applique jamais un vrai changement d'offre. */
  allowSimulator?: boolean;
  notify?: (request: PlanChangeRequest) => Promise<void>;
}

export function resolveSubscriptionProvider(
  deps: SubscriptionRegistryDeps = {},
): SubscriptionBillingProvider {
  const name = deps.provider || "manual";
  if (name === "manual") return new ManualSubscriptionProvider(deps.notify);
  if (name === "fake") {
    if (deps.allowSimulator === false) {
      throw new DomainError(
        "subscription.simulator_forbidden",
        "Le simulateur d'abonnement est interdit en production.",
      );
    }
    return new FakeSubscriptionProvider();
  }
  throw new DomainError(
    "subscription.provider_unknown",
    `Fournisseur d'abonnement « ${name} » inconnu.`,
    { provider: name },
  );
}
