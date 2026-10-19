import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `apps/web` (Next.js) charge `.env` automatiquement ; ce process `tsx` ne le
// fait pas — on le charge nous-mêmes, avant tout import de module applicatif
// (`@atelieros/db` construit son client Prisma dès son évaluation), pour que
// `pnpm dev` fonctionne sans étape manuelle (DATABASE_URL, REDIS_URL, S3_*...).
// Les imports statiques ES étant hoistés/évalués avant le corps de ce
// fichier, les modules applicatifs sont chargés dynamiquement ci-dessous,
// une fois l'environnement en place.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(dirname, "../../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  const { logger } = await import("./logger");
  const { startImportsWorker } = await import("./jobs/imports");

  logger.info("AtelierOS worker démarré");

  const importsWorker = startImportsWorker();
  logger.info({ queue: "imports" }, "worker: file « imports » prête");

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "worker: arrêt demandé");
    await importsWorker.close();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

void main();
