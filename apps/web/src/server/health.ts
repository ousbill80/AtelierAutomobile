// Étape 7.2 — sondes de `/api/health` : Postgres (deux rôles), Redis, stockage S3.
import IORedis from "ioredis";
import { buildHealthReport, type HealthReport } from "@atelieros/core";
import { pingDatabases } from "@atelieros/db";
import { getObjectStorage } from "./storage";

const globalForHealth = globalThis as unknown as { atelierosHealthRedis?: IORedis };

// Connexion dédiée et paresseuse : une panne Redis ne doit ni bloquer la réponse (pas de file
// hors ligne) ni réessayer indéfiniment une commande.
function healthRedis(url: string): IORedis {
  globalForHealth.atelierosHealthRedis ??= new IORedis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
  return globalForHealth.atelierosHealthRedis;
}

async function pingRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL manquant");
  const redis = healthRedis(url);
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  await redis.ping();
}

export function checkHealth(): Promise<HealthReport> {
  return buildHealthReport({
    database: pingDatabases,
    redis: pingRedis,
    // Pièces jointes sur disque (STORAGE_DRIVER=local) : les autres fichiers restent sur S3.
    storage: () => getObjectStorage().ping(),
  });
}
