import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { DgiApiFneProvider, type DgiApiCredentials, type FetchLike } from "../fne/dgi-api";
import { FakeFneProvider } from "../fne/fake";
import { ManualFneProvider } from "../fne/manual";
import type { FneProvider } from "../fne/provider";
import type { FneConfigStore } from "./types";

export interface FneRegistryDeps {
  store: FneConfigStore;
  /** Clé maîtresse, ou fonction qui la charge (lue seulement pour l'adaptateur `dgi_api`). */
  encryptionKey?: Buffer | (() => Buffer);
  /** `false` en production : le simulateur ne doit jamais certifier une vraie facture. */
  allowSimulator?: boolean;
  fetch?: FetchLike;
}

/** Résout le fournisseur FNE actif. `mode` "manual" ou "disabled" (ou aucune config) →
 * {@link ManualFneProvider} ; `mode = "api"` → adaptateur `dgi_api` (identifiants déchiffrés
 * ici, jamais renvoyés) ou simulateur `fake` hors production. */
export async function resolveFneProvider(
  organizationId: string,
  deps: FneRegistryDeps,
): Promise<FneProvider> {
  const config = await deps.store.get(organizationId);

  if (!config || config.mode !== "api") {
    return new ManualFneProvider();
  }

  if (config.provider === "fake") {
    if (deps.allowSimulator === false) {
      throw new DomainError(
        "fne.simulator_forbidden",
        "Le simulateur FNE est interdit en production : configurez les identifiants DGI.",
      );
    }
    return new FakeFneProvider();
  }

  if (config.provider !== "dgi_api") {
    throw new DomainError(
      "fne.provider_unknown",
      `Fournisseur FNE « ${config.provider} » inconnu.`,
      { provider: config.provider },
    );
  }
  if (!config.credentials || !deps.encryptionKey) {
    throw new DomainError(
      "fne.credentials_missing",
      "Identifiants DGI absents : renseignez-les dans Paramètres > FNE.",
    );
  }
  const key = typeof deps.encryptionKey === "function" ? deps.encryptionKey() : deps.encryptionKey;
  const credentials = JSON.parse(decryptSecret(config.credentials, key)) as DgiApiCredentials;
  return new DgiApiFneProvider(
    {
      ...credentials,
      establishmentId: config.establishmentId ?? credentials.establishmentId ?? null,
      pointOfSale: config.pointOfSale ?? credentials.pointOfSale ?? null,
    },
    deps.fetch,
  );
}
