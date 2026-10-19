import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { ConsoleMessagingProvider, type Outbox } from "../messaging/console";
import type { Channel, MessagingProvider } from "../messaging/provider";
import type { MessagingConfigStore } from "./types";
import { isLocalProvider } from "./types";

export interface MessagingRegistryDeps {
  store: MessagingConfigStore;
  encryptionKey: Buffer;
  outbox: Outbox;
}

/**
 * Résout le fournisseur de messagerie actif d'une organisation pour un canal donné. Sans
 * configuration active (ou avec le fournisseur "console"), renvoie toujours
 * {@link ConsoleMessagingProvider} : l'application ne doit jamais exiger un compte réel
 * pour tourner (CLAUDE.md). Les fournisseurs réels (WhatsApp Cloud, Orange SMS, Twilio,
 * SMTP/Resend…) sont branchés en M11 (étape 2.1) — tant qu'ils ne le sont pas, cette
 * fonction lève une erreur explicite plutôt que de les ignorer silencieusement.
 */
export async function resolveMessagingProvider(
  organizationId: string,
  channel: Channel,
  deps: MessagingRegistryDeps,
): Promise<MessagingProvider> {
  const configs = await deps.store.listActive(organizationId, channel);
  const active = [...configs].sort((a, b) => a.priority - b.priority)[0];

  if (!active || isLocalProvider(active.provider)) {
    return new ConsoleMessagingProvider(channel, deps.outbox);
  }

  // Déchiffrement effectué pour valider que le secret est lisible, même si aucun
  // fournisseur réel n'est encore branché pour le consommer.
  decryptSecret(active.credentials, deps.encryptionKey);

  throw new DomainError(
    "messaging.provider_not_implemented",
    `Fournisseur de messagerie « ${active.provider} » pas encore implémenté (prévu en M11).`,
    { provider: active.provider, channel },
  );
}
