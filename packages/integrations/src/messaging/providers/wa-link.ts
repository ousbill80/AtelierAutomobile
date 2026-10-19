import { DomainError } from "@atelieros/core";
import type { HealthStatus, MessagingProvider, ProviderEvent } from "../types";

/**
 * Fournisseur `wa_link` (US-M11-02) : pas d'API WhatsApp, aucun envoi automatique possible.
 * L'envoi réel passe par le flux manuel dédié (`messaging.waLink` / `messaging.waLinkConfirm`,
 * `core/messaging/waLink.buildWaLinkUrl`) : ce provider n'existe que pour occuper une place
 * dans le registre (disponibilité du canal, `healthCheck`) sans jamais être appelé par
 * `messages.send`.
 */
export function createWaLinkProvider(): MessagingProvider {
  return {
    channel: "WHATSAPP",
    async send() {
      throw new DomainError(
        "messaging.wa_link_manual_only",
        "wa_link n'envoie pas automatiquement : utilisez le flux « Ouvrir dans WhatsApp » (messaging.waLink).",
      );
    },
    async parseWebhook(): Promise<ProviderEvent[]> {
      return [];
    },
    async verifyWebhook(): Promise<boolean> {
      return true;
    },
    async healthCheck(): Promise<HealthStatus> {
      return { ok: true, detail: "wa_link (envoi manuel, aucun statut)" };
    },
  };
}
