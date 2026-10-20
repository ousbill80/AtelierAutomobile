// M17 — persistance du service IA (`AiStore` de `@atelieros/integrations`), partagée par
// apps/web et apps/worker : contexte de quota (plan, réglages, crédits du mois et du jour) et
// journal `AiInteraction` (RG-M17-06/07). Forme structurelle : pas de dépendance vers
// `@atelieros/integrations` depuis `@atelieros/db`.
import {
  monthStartUtc,
  resolveAiSettings,
  type AiSettings,
  type PlanTierLike,
} from "@atelieros/core";
import type { Prisma } from "@prisma/client";
import { adminDb } from "./client";
import { db } from "./tenant";

export interface DbAiOrgContext {
  plan: PlanTierLike;
  settings: AiSettings;
  creditsUsedThisMonth: number;
  userCreditsToday: number;
}

export interface DbAiInteractionRecord {
  organizationId: string;
  feature: string;
  promptVersion: string;
  inputRef: string | null;
  output: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number | null;
  status: string;
  credits: number;
  model: string | null;
  createdById: string | null;
}

/** Crédits IA consommés par l'organisation depuis le 1er du mois (fuseau de l'organisation). */
export async function aiCreditsUsedThisMonth(
  organizationId: string,
  now: Date,
  timeZone: string,
): Promise<number> {
  const tx = db.forTenant({ organizationId });
  const agg = await tx.aiInteraction.aggregate({
    where: { createdAt: { gte: monthStartUtc(now, timeZone) } },
    _sum: { credits: true },
  });
  return agg._sum.credits ?? 0;
}

export function createDbAiStore() {
  return {
    async loadContext(
      organizationId: string,
      membershipId: string | null,
      now: Date,
    ): Promise<DbAiOrgContext> {
      const org = await adminDb.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { plan: true, settings: true, timezone: true },
      });
      const creditsUsedThisMonth = await aiCreditsUsedThisMonth(organizationId, now, org.timezone);
      let userCreditsToday = 0;
      if (membershipId) {
        const tx = db.forTenant({ organizationId });
        const agg = await tx.aiInteraction.aggregate({
          where: {
            createdById: membershipId,
            feature: "assistant",
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
          _sum: { credits: true },
        });
        userCreditsToday = agg._sum.credits ?? 0;
      }
      return {
        plan: org.plan,
        settings: resolveAiSettings(org.settings),
        creditsUsedThisMonth,
        userCreditsToday,
      };
    },

    async logInteraction(record: DbAiInteractionRecord): Promise<string> {
      const tx = db.forTenant({ organizationId: record.organizationId });
      const row = await tx.aiInteraction.create({
        data: {
          organizationId: record.organizationId,
          feature: record.feature,
          promptVersion: record.promptVersion,
          inputRef: record.inputRef,
          output: (record.output ?? {}) as Prisma.InputJsonValue,
          tokensIn: record.tokensIn,
          tokensOut: record.tokensOut,
          latencyMs: record.latencyMs,
          status: record.status,
          credits: record.credits,
          model: record.model,
          createdById: record.createdById,
        },
        select: { id: true },
      });
      return row.id;
    },
  };
}
