import { PrismaClient } from "@prisma/client";

// Un seul PrismaClient par processus (évite l'épuisement du pool de connexions
// en développement, où Next.js recharge les modules à chaud).
const globalForPrisma = globalThis as unknown as { prismaAdmin?: PrismaClient };

/**
 * Chaque lecture `db.forTenant` ouvre une transaction interactive (set_config RLS).
 * Le défaut Prisma (2 s) est trop court quand le tableau de bord lance beaucoup
 * de requêtes en parallèle : « Unable to start a transaction in the given time ».
 */
export const transactionOptions = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

/**
 * Client Prisma non filtré par locataire. Réservé à l'infrastructure
 * (migrations, seed, scripts d'administration, tests d'isolation A/B).
 * Le code applicatif doit toujours passer par `db.forTenant(ctx)`.
 */
export const adminDb =
  globalForPrisma.prismaAdmin ??
  new PrismaClient({
    transactionOptions,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdmin = adminDb;
}
