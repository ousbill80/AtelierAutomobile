// M17 RG-M17-02 / §5 — suggestions IA : créées `PENDING` (48 h), remplacées quand le contexte
// change (nouveau message, devis modifié → `EXPIRED`), puis acceptées (avec ou sans
// modification) ou ignorées par un humain. L'acceptation exécute la procédure métier normale
// (permissions et audit de cette procédure) : voir `accept.ts`.
import { AI_SUGGESTION_TTL_MS, editDistance } from "@atelieros/core";
import { db, type AiSuggestion, type Prisma } from "@atelieros/db";
import { TRPCError } from "@trpc/server";

type TenantDb = ReturnType<typeof db.forTenant>;

export interface CreateSuggestionInput {
  organizationId: string;
  interactionId: string | null;
  feature: string;
  targetEntity: string;
  targetId: string | null;
  payload: unknown;
  isFallback: boolean;
  now: Date;
}

/** Crée une suggestion et périme les précédentes encore en attente pour la même cible. */
export async function createSuggestion(
  tx: TenantDb,
  input: CreateSuggestionInput,
): Promise<AiSuggestion> {
  await tx.aiSuggestion.updateMany({
    where: {
      feature: input.feature,
      targetEntity: input.targetEntity,
      targetId: input.targetId,
      status: "PENDING",
    },
    data: { status: "EXPIRED" },
  });
  return tx.aiSuggestion.create({
    data: {
      organizationId: input.organizationId,
      interactionId: input.interactionId,
      feature: input.feature,
      targetEntity: input.targetEntity,
      targetId: input.targetId,
      payload: input.payload as Prisma.InputJsonValue,
      isFallback: input.isFallback,
      expiresAt: new Date(input.now.getTime() + AI_SUGGESTION_TTL_MS),
    },
  });
}

/** Périme les suggestions en attente d'une cible (ex. nouveau message entrant). */
export async function expireSuggestionsFor(
  tx: TenantDb,
  targetEntity: string,
  targetId: string,
  features?: string[],
): Promise<void> {
  await tx.aiSuggestion.updateMany({
    where: {
      targetEntity,
      targetId,
      status: "PENDING",
      ...(features ? { feature: { in: features } } : {}),
    },
    data: { status: "EXPIRED" },
  });
}

/** Charge une suggestion encore décidable (PENDING, non expirée), sinon erreur lisible. */
export async function loadPendingSuggestion(
  tx: TenantDb,
  suggestionId: string,
  now: Date,
): Promise<AiSuggestion> {
  const suggestion = await tx.aiSuggestion.findFirst({ where: { id: suggestionId } });
  if (!suggestion) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Suggestion introuvable." });
  }
  if (suggestion.status !== "PENDING" || suggestion.expiresAt <= now) {
    if (suggestion.status === "PENDING") {
      await tx.aiSuggestion.update({ where: { id: suggestion.id }, data: { status: "EXPIRED" } });
    }
    throw new TRPCError({
      code: "CONFLICT",
      message: "Cette suggestion n'est plus d'actualité. Générez-en une nouvelle.",
    });
  }
  return suggestion;
}

/**
 * Enregistre la décision humaine sur la suggestion et sur son `AiInteraction`
 * (`accepted`, `editDistance` — RG-M17-06, US-M17-01).
 */
export async function recordSuggestionDecision(
  tx: TenantDb,
  suggestion: AiSuggestion,
  decision: {
    accepted: boolean;
    membershipId: string;
    now: Date;
    original?: string;
    final?: string;
  },
): Promise<void> {
  const distance =
    decision.accepted && decision.original !== undefined && decision.final !== undefined
      ? editDistance(decision.original, decision.final)
      : null;
  const status = !decision.accepted
    ? "DISMISSED"
    : distance && distance > 0
      ? "EDITED_ACCEPTED"
      : "ACCEPTED";
  await tx.aiSuggestion.update({
    where: { id: suggestion.id },
    data: { status, decidedById: decision.membershipId, decidedAt: decision.now },
  });
  if (suggestion.interactionId) {
    await tx.aiInteraction.update({
      where: { id: suggestion.interactionId },
      data: {
        accepted: decision.accepted,
        ...(distance !== null ? { editDistance: distance } : {}),
      },
    });
  }
}
