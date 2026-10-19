import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { ManualPaymentProvider, type ManualPaymentLedger } from "../payment/manual";
import type { PaymentProvider } from "../payment/provider";
import type { PaymentConfigStore } from "./types";
import { isLocalProvider } from "./types";

export interface PaymentRegistryDeps {
  store: PaymentConfigStore;
  encryptionKey: Buffer;
  appUrl: string;
  ledger: ManualPaymentLedger;
}

/** Résout le fournisseur de paiement actif d'une organisation. Même logique que la messagerie :
 * aucune configuration (ou "manual") → {@link ManualPaymentProvider} ; un fournisseur réel
 * (Wave, CinetPay) sera branché en M08 (étape 4.x). */
export async function resolvePaymentProvider(
  organizationId: string,
  deps: PaymentRegistryDeps,
): Promise<PaymentProvider> {
  const config = await deps.store.getActive(organizationId);

  if (!config || isLocalProvider(config.provider)) {
    return new ManualPaymentProvider(deps.appUrl, deps.ledger);
  }

  decryptSecret(config.credentials, deps.encryptionKey);

  throw new DomainError(
    "payment.provider_not_implemented",
    `Fournisseur de paiement « ${config.provider} » pas encore implémenté (prévu en M08).`,
    { provider: config.provider },
  );
}
