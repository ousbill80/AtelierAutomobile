import IORedis from "ioredis";

/**
 * Connexion Redis partagée par toutes les files BullMQ du worker (01-architecture-technique.md
 * §6). `maxRetriesPerRequest: null` est requis par BullMQ pour les connexions de worker/scheduler.
 */
export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL ?? "redis://localhost:6380";
  return new IORedis(url, { maxRetriesPerRequest: null });
}
