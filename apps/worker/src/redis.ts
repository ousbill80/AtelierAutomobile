import IORedis from "ioredis";

export function createRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL est requis pour les files BullMQ du worker.");
  }
  return new IORedis(url, { maxRetriesPerRequest: null });
}
