// M13 §8 — routeur `syncAgents` (partie 2, étape 6.4) : code d'appairage, liste et
// révocation des agents locaux (RG-M13-28). Chaque agent alimente sa propre source
// `SQL_DATABASE` (config `dbType = agent`) dont les requêtes se règlent dans /import/sources.
import { TRPCError } from "@trpc/server";
import { effectiveAgentStatus, generatePairingCode, pairingExpiresAt } from "@atelieros/core";
import { db } from "@atelieros/db";
import { serializeSqlSourceConfig } from "@atelieros/import";
import { loadEncryptionKey } from "@atelieros/integrations";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { requirePermission, router } from "../trpc";

export const syncAgentsRouter = router({
  createPairingCode: requirePermission("integration:manage")
    .input(z.object({ name: z.string().trim().min(1, "Nom obligatoire.").max(120) }))
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const now = new Date();
      const source = await tenantDb.dataSource.create({
        data: {
          organizationId: ctx.organizationId,
          type: "SQL_DATABASE",
          name: `Agent — ${input.name}`,
          config: serializeSqlSourceConfig({ dbType: "agent", queries: {} }, loadEncryptionKey()),
        },
        select: { id: true },
      });
      const agent = await tenantDb.syncAgent.create({
        data: {
          organizationId: ctx.organizationId,
          dataSourceId: source.id,
          name: input.name,
          pairingCode: generatePairingCode(),
          pairingExpiresAt: pairingExpiresAt(now),
        },
      });
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "sync_agent.pairing_code_created",
        entity: "SyncAgent",
        entityId: agent.id,
        after: { name: input.name },
      });
      return {
        agentId: agent.id,
        dataSourceId: source.id,
        code: agent.pairingCode!,
        expiresAt: agent.pairingExpiresAt!,
      };
    }),

  list: requirePermission("integration:manage").query(async ({ ctx }) => {
    const rows = await db.forTenant({ organizationId: ctx.organizationId }).syncAgent.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        version: true,
        hostname: true,
        lastSeenAt: true,
        lastError: true,
        dataSourceId: true,
        pairingExpiresAt: true,
        createdAt: true,
        dataSource: { select: { lastSuccessAt: true } },
      },
    });
    const now = new Date();
    return rows.map(({ dataSource, ...agent }) => ({
      ...agent,
      status: effectiveAgentStatus(agent, now),
      pairingExpired:
        agent.status === "PAIRING" &&
        (!agent.pairingExpiresAt || agent.pairingExpiresAt.getTime() < now.getTime()),
      lastSyncAt: dataSource?.lastSuccessAt ?? null,
    }));
  }),

  revoke: requirePermission("integration:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tenantDb = db.forTenant({ organizationId: ctx.organizationId });
      const agent = await tenantDb.syncAgent.findFirst({ where: { id: input.id } });
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent introuvable." });
      const now = new Date();
      await tenantDb.syncAgent.update({
        where: { id: agent.id },
        data: { status: "REVOKED", revokedAt: now, pairingCode: null, pairingExpiresAt: null },
      });
      if (agent.dataSourceId) {
        await tenantDb.dataSource.update({
          where: { id: agent.dataSourceId },
          data: { isActive: false },
        });
      }
      await writeAuditLog({
        organizationId: ctx.organizationId,
        userId: ctx.user.id,
        membershipId: ctx.membership.id,
        action: "sync_agent.revoked",
        entity: "SyncAgent",
        entityId: agent.id,
      });
      return { ok: true };
    }),
});
