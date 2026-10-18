import { PrismaClient } from "@prisma/client";

// Un seul PrismaClient par processus (évite l'épuisement du pool de connexions
// en développement, où Next.js recharge les modules à chaud).
const globalForPrisma = globalThis as unknown as { prismaAdmin?: PrismaClient };

/**
 * Client Prisma non filtré par locataire. Réservé à l'infrastructure
 * (migrations, seed, scripts d'administration, tests d'isolation A/B).
 * Le code applicatif doit toujours passer par `db.forTenant(ctx)`.
 */
export const adminDb = globalForPrisma.prismaAdmin ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaAdmin = adminDb;
}
