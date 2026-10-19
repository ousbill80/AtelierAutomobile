import { TRPCError } from "@trpc/server";
import { isDomainError } from "@atelieros/core";

/** Convertit une `DomainError` (packages/core) en erreur tRPC lisible côté client. */
export function toTRPCError(error: unknown): never {
  if (isDomainError(error)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}
