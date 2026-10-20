// M08 §FNE — fournisseur FNE d'une organisation pour les routeurs (même résolution que le
// worker) ; remplaçable dans les tests d'intégration par un simulateur paramétré.
import { loadFneConfigRecord, type ResolveFneCertifier } from "@atelieros/db";
import { loadEncryptionKey, resolveFneProvider, type FneProvider } from "@atelieros/integrations";

export function resolveFneFromConfig(organizationId: string): Promise<FneProvider> {
  return resolveFneProvider(organizationId, {
    store: { get: loadFneConfigRecord },
    encryptionKey: () => loadEncryptionKey(),
    allowSimulator: process.env.APP_ENV !== "production",
  });
}

let override: ResolveFneCertifier | null = null;

/** Tests : injecte un fournisseur (ex. simulateur qui échoue N fois) ; `null` rétablit la config. */
export function setFneProviderResolver(resolver: ResolveFneCertifier | null): void {
  override = resolver;
}

export const fneCertifierFor: ResolveFneCertifier = (organizationId) =>
  override ? override(organizationId) : resolveFneFromConfig(organizationId);
