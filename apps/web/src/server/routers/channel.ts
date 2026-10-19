import { TRPCError } from "@trpc/server";
import { db } from "@atelieros/db";
import {
  defaultOutbox,
  encryptSecret,
  loadEncryptionKey,
  resolveMessagingProvider,
  type MessageChannel,
  type MessagingConfigStore,
} from "@atelieros/integrations";
import { channelTestInputSchema, channelUpsertInputSchema } from "@atelieros/validators";
import { requirePermission, router } from "../trpc";

function isLocalProvider(provider: string): boolean {
  return provider === "console" || provider === "wa_link";
}

// RG-M11 : les identifiants chiffrés ne sont jamais renvoyés au front (CLAUDE.md).
function withoutCredentials<T extends { credentials: string }>(row: T): Omit<T, "credentials"> {
  const { credentials, ...rest } = row;
  void credentials;
  return rest;
}

function configStore(tx: ReturnType<typeof db.forTenant>): MessagingConfigStore {
  return {
    async listActive(_organizationId: string, channel: MessageChannel) {
      const rows = await tx.channelConfig.findMany({ where: { channel, isActive: true } });
      return rows
        .filter((r) => r.status !== "ERROR")
        .map((r) => ({
          channel: r.channel as MessageChannel,
          provider: r.provider,
          isActive: r.isActive,
          priority: r.priority,
          credentials: r.credentials,
          senderId: r.senderId,
        }));
    },
  };
}

export const channelRouter = router({
  list: requirePermission("settings:channels").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.channelConfig.findMany({
      orderBy: [{ channel: "asc" }, { priority: "asc" }],
    });
    return rows.map(withoutCredentials);
  }),

  upsert: requirePermission("settings:channels")
    .input(channelUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const local = isLocalProvider(input.provider);
      const credentials = local
        ? ""
        : encryptSecret(JSON.stringify(input.credentials), loadEncryptionKey());

      const data = {
        isActive: input.isActive,
        priority: input.priority,
        senderId: input.senderId,
        status: null,
        lastError: null,
        ...(local ? {} : { credentials }),
      };

      if (input.id) {
        const updated = await tenantDb.channelConfig.update({ where: { id: input.id }, data });
        return withoutCredentials(updated);
      }
      const created = await tenantDb.channelConfig.create({
        data: {
          organizationId: ctx.organizationId,
          channel: input.channel,
          provider: input.provider,
          credentials,
          ...data,
        },
      });
      return withoutCredentials(created);
    }),

  test: requirePermission("settings:channels")
    .input(channelTestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const config = await tenantDb.channelConfig.findFirst({ where: { id: input.id } });
      if (!config) throw new TRPCError({ code: "NOT_FOUND" });

      const provider = await resolveMessagingProvider(
        ctx.organizationId,
        config.channel as MessageChannel,
        {
          store: configStore(tenantDb),
          encryptionKey: loadEncryptionKey(),
          outbox: defaultOutbox,
        },
      );
      const health = await provider.healthCheck();
      await tenantDb.channelConfig.update({
        where: { id: config.id },
        data: {
          status: health.ok ? "OK" : "ERROR",
          lastCheckedAt: new Date(),
          lastError: health.ok ? null : (health.detail ?? "Échec du test"),
        },
      });
      return health;
    }),
});
