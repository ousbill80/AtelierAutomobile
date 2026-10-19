import { isDomainError } from "@atelieros/core";
import { TRPCError } from "@trpc/server";

/** Convertit une `DomainError` (packages/core) en erreur tRPC lisible côté client. */
export function toTRPCError(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

/**
 * Convertit une `DomainError` levée par `packages/core` (règles métier pures, ex.
 * `validateOpeningHours`, `validateNumberingConfig`) en `TRPCError` lisible côté client.
 * Les autres erreurs ne sont pas interceptées.
 */
export function withDomainErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (isDomainError(error)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }
    throw error;
  }
}
