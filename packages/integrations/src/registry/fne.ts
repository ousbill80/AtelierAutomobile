import { DomainError } from "@atelieros/core";
import { ManualFneProvider } from "../fne/manual";
import type { FneProvider } from "../fne/provider";
import type { FneConfigStore } from "./types";

/** Résout le fournisseur FNE actif. `mode` "manual" ou "disabled" (ou aucune config) →
 * {@link ManualFneProvider} : la certification automatique n'est possible qu'en mode
 * "api", qui dépend de la spécification DGI non encore obtenue (01-architecture-technique.md §10). */
export async function resolveFneProvider(
  organizationId: string,
  store: FneConfigStore,
): Promise<FneProvider> {
  const config = await store.get(organizationId);

  if (!config || config.mode !== "api") {
    return new ManualFneProvider();
  }

  throw new DomainError(
    "fne.api_mode_not_implemented",
    "Mode FNE « api » pas encore implémenté : en attente de la spécification DGI.",
  );
}
