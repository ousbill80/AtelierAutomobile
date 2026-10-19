// M07 — orchestration commune des routeurs stock / achats : transaction locataire avec le
// contexte stock (paramètres, numérotation), conversion des erreurs métier, unités.
import { isDomainError, toBaseQty } from "@atelieros/core";
import {
  db,
  loadStockContext,
  Prisma,
  type ScopedTenantClient,
  type StockContext,
} from "@atelieros/db";
import { TRPCError } from "@trpc/server";

export interface StockCallerCtx {
  organizationId: string;
  membership: { id: string; role: string };
  permissions: Set<string>;
  allowedSiteIds: string[] | "ALL";
}

/** Horloge du module (remplaçable dans les tests via STOCK_NOW, comme `receivablesNow`). */
export function stockNow(): Date {
  return process.env.STOCK_NOW ? new Date(process.env.STOCK_NOW) : new Date();
}

/** Convertit une DomainError / violation d'unicité Prisma en erreur tRPC lisible. */
export function toTrpcError(error: unknown): unknown {
  if (isDomainError(error)) {
    return new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return new TRPCError({ code: "NOT_FOUND", message: "Élément introuvable." });
    }
    if (error.code === "P2034") {
      return new TRPCError({
        code: "CONFLICT",
        message: "Opération concurrente en cours sur ce stock. Réessayez.",
      });
    }
  }
  if (error instanceof Error && error.name === "NotFoundError") {
    return new TRPCError({ code: "NOT_FOUND", message: "Élément introuvable." });
  }
  return error;
}

export async function withDomain<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toTrpcError(error);
  }
}

/** Ouvre UNE transaction locataire avec le contexte stock, erreurs métier converties. */
export async function stockTx<T>(
  organizationId: string,
  fn: (tx: ScopedTenantClient, stock: StockContext, now: Date) => Promise<T>,
): Promise<T> {
  const stock = await loadStockContext(organizationId);
  const now = stockNow();
  return withDomain(() =>
    db.forTenant({ organizationId }).transaction((tx) => fn(tx, stock, now), { timeout: 30_000 }),
  );
}

/** Quantité saisie (unités d'affichage) → unités de base du produit. */
export function baseQty(displayQty: number, quantityScale: number): number {
  try {
    return toBaseQty(displayQty, quantityScale);
  } catch (error) {
    throw toTrpcError(error);
  }
}

/** Le coût (CMP, prix d'achat, marge) n'est visible qu'avec `product:view_cost`. */
export function canSeeCost(ctx: { permissions: Set<string> }): boolean {
  return ctx.permissions.has("product:view_cost");
}

export function siteFilter(ctx: { allowedSiteIds: string[] | "ALL" }) {
  return ctx.allowedSiteIds === "ALL" ? {} : { siteId: { in: ctx.allowedSiteIds } };
}
