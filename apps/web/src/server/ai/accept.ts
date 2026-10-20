// M17 §8 — `ai.suggestion.accept` dispatche vers la procédure métier selon la fonction de la
// suggestion, en vérifiant **ses** permissions (RG-M17-02). Chaque fonction enregistre son
// gestionnaire ici ; aucun gestionnaire n'élargit les droits de l'utilisateur.
import type { AiSuggestion } from "@atelieros/db";
import type { Permission } from "@atelieros/core";
import { TRPCError } from "@trpc/server";
import type { CtxMembership, CtxUser } from "../context";

export interface AcceptContext {
  organizationId: string;
  membership: CtxMembership;
  user: CtxUser;
  permissions: Set<Permission>;
  allowedSiteIds: string[] | "ALL";
  ip: string | null;
  userAgent: string | null;
}

export interface AcceptArgs {
  ctx: AcceptContext;
  suggestion: AiSuggestion;
  /** Charge utile modifiée par l'humain (« Modifier » puis « Envoyer »), sinon `undefined`. */
  editedPayload: unknown;
  now: Date;
}

export interface AcceptHandler {
  /** Permissions de la procédure métier appelée à l'acceptation. */
  permissions: Permission[];
  run(args: AcceptArgs): Promise<{ result: unknown; original?: string; final?: string }>;
}

const handlers = new Map<string, AcceptHandler>();

export function registerAcceptHandler(feature: string, handler: AcceptHandler): void {
  handlers.set(feature, handler);
}

export function acceptHandlerFor(feature: string): AcceptHandler {
  const handler = handlers.get(feature);
  if (!handler) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cette suggestion ne peut pas être appliquée automatiquement.",
    });
  }
  return handler;
}

export function assertAcceptPermissions(ctx: AcceptContext, handler: AcceptHandler): void {
  const missing = handler.permissions.filter((p) => !ctx.permissions.has(p));
  if (missing.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Vous n'avez pas les droits pour appliquer cette suggestion.",
      cause: { missing },
    });
  }
}
