// M17 §8 — routeur `ai` : réglages (RG-M17-10), consommation et journal (§7 `/parametres/ia`),
// disponibilité par fonction (bouton IA désactivé + info-bulle), décision sur les suggestions
// (RG-M17-02). Les fonctions elles-mêmes sont définies dans `apps/web/src/server/ai/*` et
// fusionnées ici.
import {
  AI_CREDITS_BY_PLAN,
  AI_FEATURES,
  DEFAULT_AI_SETTINGS,
  monthStartUtc,
  resolveAiSettings,
  type AiFeature,
} from "@atelieros/core";
import { adminDb, aiCreditsUsedThisMonth, db, type Prisma } from "@atelieros/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { writeAuditLog } from "../audit";
import { acceptHandlerFor, assertAcceptPermissions } from "../ai/accept";
import { getAiService } from "../ai/service";
import { loadPendingSuggestion, recordSuggestionDecision } from "../ai/suggestions";
import { aiFeatureProcedures } from "../ai/procedures";
import { requirePermission, router } from "../trpc";

const featureSchema = z.enum(AI_FEATURES);

const updateAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  features: z.record(featureSchema, z.boolean()).optional(),
  autoTimeOptimization: z.boolean().optional(),
  assistantEnabled: z.boolean().optional(),
});

export const aiRouter = router({
  /** Disponibilité de chaque fonction pour l'utilisateur courant (sans appel au modèle). */
  status: requirePermission("ai:use").query(async ({ ctx }) => {
    const service = getAiService();
    const entries = await Promise.all(
      AI_FEATURES.map(async (feature) => [
        feature,
        await service.availability(
          { organizationId: ctx.organizationId, membershipId: ctx.membership.id },
          feature,
        ),
      ]),
    );
    return Object.fromEntries(entries) as Record<
      AiFeature,
      { available: true } | { available: false; reason: string; status: string }
    >;
  }),

  settings: router({
    get: requirePermission("ai:configure").query(async ({ ctx }) => {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: ctx.organizationId },
        select: { settings: true },
      });
      return { ai: resolveAiSettings(org.settings), provider: getAiService().provider.name };
    }),

    update: requirePermission("ai:configure")
      .input(updateAiSettingsSchema)
      .mutation(async ({ ctx, input }) => {
        const org = await adminDb.organization.findUniqueOrThrow({
          where: { id: ctx.organizationId },
          select: { settings: true },
        });
        const before = resolveAiSettings(org.settings);
        const after = {
          ...before,
          ...input,
          features: { ...before.features, ...(input.features ?? {}) },
        };
        const current =
          typeof org.settings === "object" && org.settings && !Array.isArray(org.settings)
            ? (org.settings as Record<string, unknown>)
            : {};
        await adminDb.organization.update({
          where: { id: ctx.organizationId },
          data: { settings: { ...current, ai: after } as Prisma.InputJsonValue },
        });
        await writeAuditLog({
          organizationId: ctx.organizationId,
          userId: ctx.user.id,
          membershipId: ctx.membership.id,
          action: "settings.ai_updated",
          entity: "Organization",
          entityId: ctx.organizationId,
          before: { ai: before },
          after: { ai: after },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return { ai: after };
      }),

    defaults: requirePermission("ai:configure").query(() => DEFAULT_AI_SETTINGS),
  }),

  /** §7 — consommation du mois : crédits, top fonctions, taux d'acceptation par fonction. */
  usage: requirePermission("ai:configure").query(async ({ ctx }) => {
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { plan: true, timezone: true },
    });
    const now = new Date();
    const since = monthStartUtc(now, org.timezone);
    const tx = db.forTenant({ organizationId: ctx.organizationId });
    const [credits, groups, decided] = await Promise.all([
      aiCreditsUsedThisMonth(ctx.organizationId, now, org.timezone),
      tx.aiInteraction.groupBy({
        by: ["feature"],
        where: { createdAt: { gte: since } },
        _sum: { credits: true },
        _count: { _all: true },
      }),
      tx.aiInteraction.groupBy({
        by: ["feature", "accepted"],
        where: { createdAt: { gte: since }, accepted: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const byFeature = groups
      .map((g) => {
        const accepted = decided
          .filter((d) => d.feature === g.feature && d.accepted === true)
          .reduce((s, d) => s + d._count._all, 0);
        const total = decided
          .filter((d) => d.feature === g.feature)
          .reduce((s, d) => s + d._count._all, 0);
        return {
          feature: g.feature,
          calls: g._count._all,
          credits: g._sum.credits ?? 0,
          acceptanceRate: total ? accepted / total : null,
        };
      })
      .sort((a, b) => b.credits - a.credits);
    return { credits, quota: AI_CREDITS_BY_PLAN[org.plan], plan: org.plan, byFeature };
  }),

  /** §7 — journal des 100 derniers appels (jamais l'entrée brute, RG-M17-06). */
  interactions: router({
    list: requirePermission("ai:configure")
      .input(z.object({ feature: featureSchema.optional() }).default({}))
      .query(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        return tx.aiInteraction.findMany({
          where: input.feature ? { feature: input.feature } : {},
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            feature: true,
            promptVersion: true,
            status: true,
            credits: true,
            accepted: true,
            editDistance: true,
            latencyMs: true,
            model: true,
            createdAt: true,
          },
        });
      }),
  }),

  suggestion: router({
    /** Suggestions en attente pour une cible (ex. une conversation, un OR). */
    listFor: requirePermission("ai:use")
      .input(z.object({ targetEntity: z.string(), targetId: z.string() }))
      .query(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        return tx.aiSuggestion.findMany({
          where: {
            targetEntity: input.targetEntity,
            targetId: input.targetId,
            status: "PENDING",
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
        });
      }),

    accept: requirePermission("ai:use")
      .input(z.object({ suggestionId: z.string(), editedPayload: z.unknown().optional() }))
      .mutation(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const now = new Date();
        const suggestion = await loadPendingSuggestion(tx, input.suggestionId, now);
        const handler = acceptHandlerFor(suggestion.feature);
        assertAcceptPermissions(ctx, handler);
        const outcome = await handler.run({
          ctx,
          suggestion,
          editedPayload: input.editedPayload,
          now,
        });
        await recordSuggestionDecision(tx, suggestion, {
          accepted: true,
          membershipId: ctx.membership.id,
          now,
          original: outcome.original,
          final: outcome.final,
        });
        return outcome.result;
      }),

    dismiss: requirePermission("ai:use")
      .input(z.object({ suggestionId: z.string(), reason: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const tx = db.forTenant({ organizationId: ctx.organizationId });
        const now = new Date();
        const suggestion = await tx.aiSuggestion.findFirst({ where: { id: input.suggestionId } });
        if (!suggestion) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion introuvable." });
        }
        if (suggestion.status === "PENDING") {
          await recordSuggestionDecision(tx, suggestion, {
            accepted: false,
            membershipId: ctx.membership.id,
            now,
          });
        }
        return { ok: true };
      }),
  }),

  ...aiFeatureProcedures,
});
