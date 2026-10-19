import { DomainError } from "@atelieros/core";
import { decryptSecret } from "../encryption";
import { createConsoleMessagingProvider, MessagingOutbox } from "../messaging/console";
import type { MessageChannel, MessagingProvider } from "../messaging/types";
import { createHttpSmsProvider } from "../messaging/providers/http-sms";
import { createOrangeSmsProvider } from "../messaging/providers/orange-sms";
import { createResendProvider } from "../messaging/providers/resend";
import { createSmtpProvider } from "../messaging/providers/smtp";
import { createTwilioProvider } from "../messaging/providers/twilio";
import { createWaLinkProvider } from "../messaging/providers/wa-link";
import { createWhatsappCloudProvider } from "../messaging/providers/whatsapp-cloud";
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

  // RG-M11-04 : wa_link n'a pas d'API, donc pas de secret à déchiffrer (US-M11-02).
  if (active.provider === "wa_link") {
    return createWaLinkProvider();
  }

  const credentials = JSON.parse(decryptSecret(active.credentials, deps.encryptionKey)) as Record<
    string,
    unknown
  >;

  switch (active.provider) {
    case "whatsapp_cloud":
      return createWhatsappCloudProvider(
        credentials as unknown as Parameters<typeof createWhatsappCloudProvider>[0],
      );
    case "orange_sms":
      return createOrangeSmsProvider(
        credentials as unknown as Parameters<typeof createOrangeSmsProvider>[0],
      );
    case "twilio":
      return createTwilioProvider(
        credentials as unknown as Parameters<typeof createTwilioProvider>[0],
      );
    case "http_sms":
      return createHttpSmsProvider(
        credentials as unknown as Parameters<typeof createHttpSmsProvider>[0],
      );
    case "resend":
      return createResendProvider(
        credentials as unknown as Parameters<typeof createResendProvider>[0],
      );
    case "smtp":
      return createSmtpProvider(credentials as unknown as Parameters<typeof createSmtpProvider>[0]);
    default:
      throw new DomainError(
        "messaging.provider_not_implemented",
        `Fournisseur de messagerie « ${active.provider} » pas encore implémenté.`,
        { provider: active.provider, channel },
      );
  }
}
