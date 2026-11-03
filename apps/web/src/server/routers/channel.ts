import { TRPCError } from "@trpc/server";
import { isDomainError } from "@atelieros/core";
import { db } from "@atelieros/db";
import {
  decryptSecret,
  defaultOutbox,
  encryptSecret,
  loadEncryptionKey,
  resolveMessagingProvider,
  type MessageChannel,
  type MessagingConfigStore,
} from "@atelieros/integrations";
import {
  channelSetActiveInputSchema,
  channelTestInputSchema,
  channelUpsertInputSchema,
} from "@atelieros/validators";
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

/**
 * Magasin restreint à une seule configuration : « Vérifier maintenant » teste la ligne
 * demandée (même inactive ou en erreur), pas celle que la résolution prioritaire choisirait.
 */
function singleConfigStore(row: {
  channel: string;
  provider: string;
  priority: number;
  credentials: string;
  senderId: string | null;
}): MessagingConfigStore {
  return {
    async listActive() {
      return [
        {
          channel: row.channel as MessageChannel,
          provider: row.provider,
          isActive: true,
          priority: row.priority,
          credentials: row.credentials,
          senderId: row.senderId,
        },
      ];
    },
  };
}

/** Champs réellement saisis : une valeur vide signifie « garder la valeur enregistrée ». */
function filledCredentials(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) =>
      typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined,
    ),
  );
}

function decryptExisting(credentials: string, key: Buffer): Record<string, unknown> {
  if (!credentials) return {};
  try {
    const parsed: unknown = JSON.parse(decryptSecret(credentials, key));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const channelRouter = router({
  list: requirePermission("settings:channels").query(async ({ ctx }) => {
    const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
    const rows = await tenantDb.channelConfig.findMany({
      orderBy: [{ channel: "asc" }, { priority: "asc" }],
    });
    return rows.map((row) => ({
      ...withoutCredentials(row),
      // Indique seulement si des identifiants sont enregistrés, jamais leur valeur.
      hasCredentials: row.credentials.length > 0,
    }));
  }),

  /**
   * Création ou mise à jour. En mise à jour, les identifiants enregistrés sont conservés :
   * seuls les champs non vides de `credentials` remplacent les valeurs existantes (un
   * formulaire laissé vide ou un `{}` n'efface jamais une clé).
   */
  upsert: requirePermission("settings:channels")
    .input(channelUpsertInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const local = isLocalProvider(input.provider);
      const filled = filledCredentials(input.credentials);

      // Une ligne (organisation, canal, fournisseur) est unique : reconfigurer = mettre à jour.
      const existing = input.id
        ? await tenantDb.channelConfig.findFirst({ where: { id: input.id } })
        : await tenantDb.channelConfig.findFirst({
            where: { channel: input.channel, provider: input.provider },
          });
      if (input.id && !existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Configuration de canal introuvable." });
      }

      if (existing) {
        const sameProvider = existing.provider === input.provider;
        let credentials: string | undefined;
        if (local) {
          credentials = "";
        } else if (Object.keys(filled).length > 0 || !sameProvider) {
          const key = loadEncryptionKey();
          const base = sameProvider ? decryptExisting(existing.credentials, key) : {};
          credentials = encryptSecret(JSON.stringify({ ...base, ...filled }), key);
        }
        const credentialsChanged =
          credentials !== undefined && credentials !== existing.credentials;
        const updated = await tenantDb.channelConfig.update({
          where: { id: existing.id },
          data: {
            provider: input.provider,
            isActive: input.isActive,
            priority: input.priority,
            ...(input.senderId !== undefined ? { senderId: input.senderId } : {}),
            ...(credentialsChanged || !sameProvider
              ? { credentials, status: null, lastError: null }
              : {}),
          },
        });
        return withoutCredentials(updated);
      }

      const created = await tenantDb.channelConfig.create({
        data: {
          organizationId: ctx.organizationId,
          channel: input.channel,
          provider: input.provider,
          credentials: local ? "" : encryptSecret(JSON.stringify(filled), loadEncryptionKey()),
          isActive: input.isActive,
          priority: input.priority,
          senderId: input.senderId,
          status: null,
          lastError: null,
        },
      });
      return withoutCredentials(created);
    }),

  /** Activer/désactiver sans jamais toucher aux identifiants chiffrés. */
  setActive: requirePermission("settings:channels")
    .input(channelSetActiveInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const config = await tenantDb.channelConfig.findFirst({ where: { id: input.id } });
      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Configuration de canal introuvable." });
      }
      const updated = await tenantDb.channelConfig.update({
        where: { id: config.id },
        data: { isActive: input.isActive },
      });
      return withoutCredentials(updated);
    }),

  test: requirePermission("settings:channels")
    .input(channelTestInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const config = await tenantDb.channelConfig.findFirst({ where: { id: input.id } });
      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Configuration de canal introuvable." });
      }

      let health: { ok: boolean; detail?: string };
      try {
        const provider = await resolveMessagingProvider(
          ctx.organizationId,
          config.channel as MessageChannel,
          {
            store: singleConfigStore(config),
            encryptionKey: loadEncryptionKey(),
            outbox: defaultOutbox,
          },
        );
        health = await provider.healthCheck();
      } catch (error) {
        // Identifiants illisibles ou fournisseur injoignable : jamais le secret dans le message.
        health = {
          ok: false,
          detail: isDomainError(error)
            ? error.message
            : "Vérification impossible : contrôlez les identifiants enregistrés.",
        };
      }
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
