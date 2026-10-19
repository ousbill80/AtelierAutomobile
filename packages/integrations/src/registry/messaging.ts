import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { createConsoleMessagingProvider, MessagingOutbox } from "../messaging/console";
import type { MessageChannel, MessagingProvider } from "../messaging/types";
import type { MessagingConfigStore } from "./types";
import { isLocalProvider } from "./types";

export interface MessagingRegistryDeps {
  store: MessagingConfigStore;
  encryptionKey: Buffer;
  outbox: MessagingOutbox;
}

/**
 * Résout le fournisseur de messagerie actif d'une organisation pour un canal donné. Sans
 * configuration active (ou avec le fournisseur "console"), renvoie toujours
 * {@link createConsoleMessagingProvider} : l'application ne doit jamais exiger un compte réel
 * pour tourner (CLAUDE.md).
 */
export async function resolveMessagingProvider(
  organizationId: string,
  channel: MessageChannel,
  deps: MessagingRegistryDeps,
): Promise<MessagingProvider> {
  const configs = await deps.store.listActive(organizationId, channel);
  const active = [...configs].sort((a, b) => a.priority - b.priority)[0];

  if (!active || isLocalProvider(active.provider)) {
    return createConsoleMessagingProvider(channel, deps.outbox);
  }

  // Déchiffrement effectué pour valider que le secret est lisible, même si aucun
  // fournisseur réel n'est encore branché pour le consommer.
  decryptSecret(active.credentials, deps.encryptionKey);

  throw new DomainError(
    "messaging.provider_not_implemented",
    `Fournisseur de messagerie « ${active.provider} » pas encore implémenté.`,
    { provider: active.provider, channel },
  );
}
