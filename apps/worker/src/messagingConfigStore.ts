import type {
  MessageChannel,
  MessagingConfigRecord,
  MessagingConfigStore,
} from "@atelieros/integrations";
import { db } from "@atelieros/db";

/**
 * `MessagingConfigStore` adossé à `ChannelConfig` (packages/db). Utilisé par
 * `resolveMessagingProvider` (packages/integrations) pour déterminer le fournisseur actif d'une
 * organisation sur un canal donné — en local/dev/tests, aucune ligne active ⇒ fournisseur
 * `console` (CLAUDE.md : jamais besoin d'un compte réel).
 */
export const prismaMessagingConfigStore: MessagingConfigStore = {
  async listActive(
    organizationId: string,
    channel: MessageChannel,
  ): Promise<MessagingConfigRecord[]> {
    const tenantDb = db.forTenant({ organizationId });
    const rows = await tenantDb.channelConfig.findMany({
      where: { channel, isActive: true },
      orderBy: { priority: "asc" },
    });
    return rows.map((row) => ({
      channel: row.channel as MessageChannel,
      provider: row.provider,
      isActive: row.isActive,
      priority: row.priority,
      credentials: row.credentials,
      senderId: row.senderId,
    }));
  },
};
