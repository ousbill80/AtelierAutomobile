// Étape 7.2 — serveur HTTP minimal de santé pour le conteneur worker.
// Permet au healthcheck Docker / orchestrateur de vérifier que le worker est actif
// et que ses dépendances (Postgres, Redis) répondent.
import http from "node:http";
import { buildHealthReport, type HealthReport } from "@atelieros/core";
import { pingDatabases } from "@atelieros/db";
import { logger } from "./logger";
import { createRedisConnection } from "./redis";

export function checkWorkerHealth(): Promise<HealthReport> {
  return buildHealthReport({
    database: pingDatabases,
    redis: async () => {
      const redis = createRedisConnection();
      await redis.ping();
      redis.disconnect();
    },
  });
}

export function startWorkerHealthServer(
  port = Number(process.env.WORKER_HEALTH_PORT ?? 3001),
): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/health" || req.url === "/") {
      try {
        const report = await checkWorkerHealth();
        const code = report.status === "ok" ? 200 : 503;
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...report,
            role: "worker",
            version: process.env.ATELIEROS_VERSION ?? "dev",
          }),
        );
      } catch (err) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "degraded", error: (err as Error).message }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "worker: sonde de santé HTTP prête");
  });

  return server;
}
