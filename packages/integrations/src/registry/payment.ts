import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { CinetPayProvider, type CinetPayCredentials } from "../payment/cinetpay";
import { FakePaymentProvider, type SimulatorLedger } from "../payment/fake";
import { ManualPaymentProvider, type ManualPaymentLedger } from "../payment/manual";
import type { FetchLike, PaymentProvider } from "../payment/provider";
import { WaveProvider, type WaveCredentials } from "../payment/wave";
import type { PaymentConfigRecord, PaymentConfigStore } from "./types";
import { isLocalProvider } from "./types";

/** Fournisseurs de liens de paiement connus (M15 RG-M15-17). */
export const PAYMENT_PROVIDERS = ["cinetpay", "wave", "fake"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/** Champs d'identifiants attendus par fournisseur (tous secrets, chiffrés en base). */
export const PAYMENT_CREDENTIAL_FIELDS: Record<PaymentProviderName, readonly string[]> = {
  cinetpay: ["apiKey", "siteId", "secretKey"],
  wave: ["apiKey", "webhookSecret"],
  fake: ["webhookSecret"],
};

export interface PaymentRegistryDeps {
  store: PaymentConfigStore;
  /** Clé maîtresse, ou fonction qui la charge (lue seulement pour un fournisseur réel). */
  encryptionKey: Buffer | (() => Buffer);
  appUrl: string;
  ledger: ManualPaymentLedger;
  /** `false` en production : le simulateur ne doit jamais encaisser une vraie facture. */
  allowSimulator?: boolean;
  simulatorLedger?: SimulatorLedger;
  fetch?: FetchLike;
}

function keyOf(deps: Pick<PaymentRegistryDeps, "encryptionKey">): Buffer {
  return typeof deps.encryptionKey === "function" ? deps.encryptionKey() : deps.encryptionKey;
}

/**
 * Construit l'adaptateur d'une configuration (identifiants déchiffrés ici, au dernier moment,
 * jamais renvoyés ni journalisés). Utilisé pour le lien (fournisseur actif) et pour le webhook
 * (fournisseur nommé dans l'URL).
 */
export function buildPaymentProvider(
  config: PaymentConfigRecord,
  deps: Omit<PaymentRegistryDeps, "store" | "ledger">,
): PaymentProvider {
  const provider = config.provider as PaymentProviderName;
  if (!PAYMENT_PROVIDERS.includes(provider)) {
    throw new DomainError(
      "payment.provider_unknown",
      `Fournisseur de paiement « ${config.provider} » inconnu.`,
      { provider: config.provider },
    );
  }
  if (provider === "fake" && deps.allowSimulator === false) {
    throw new DomainError(
      "payment.simulator_forbidden",
      "Le simulateur de paiement est interdit en production : configurez CinetPay ou Wave.",
    );
  }
  let credentials: Record<string, string>;
  try {
    credentials = JSON.parse(decryptSecret(config.credentials, keyOf(deps))) as Record<
      string,
      string
    >;
  } catch {
    throw new DomainError(
      "payment.credentials_invalid",
      "Identifiants du fournisseur de paiement illisibles : ressaisissez-les dans Paramètres > Paiements.",
    );
  }
  const missing = PAYMENT_CREDENTIAL_FIELDS[provider].filter((f) => !credentials[f]);
  if (missing.length > 0) {
    throw new DomainError(
      "payment.credentials_missing",
      "Identifiants du fournisseur de paiement incomplets : complétez-les dans Paramètres > Paiements.",
      { missing },
    );
  }
  if (provider === "cinetpay") {
    return new CinetPayProvider(credentials as unknown as CinetPayCredentials, deps.fetch);
  }
  if (provider === "wave") {
    return new WaveProvider(credentials as unknown as WaveCredentials, deps.fetch);
  }
  return new FakePaymentProvider({
    appUrl: deps.appUrl,
    webhookSecret: credentials.webhookSecret!,
    ledger: deps.simulatorLedger,
  });
}

/** Résout le fournisseur de paiement actif d'une organisation ; aucun (ou "manual") → manuel. */
export async function resolvePaymentProvider(
  organizationId: string,
  deps: PaymentRegistryDeps,
): Promise<PaymentProvider> {
  const config = await deps.store.getActive(organizationId);
  if (!config || isLocalProvider(config.provider)) {
    return new ManualPaymentProvider(deps.appUrl, deps.ledger);
  }
  return buildPaymentProvider(config, deps);
}
