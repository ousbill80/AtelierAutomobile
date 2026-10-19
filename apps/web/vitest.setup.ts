import { existsSync } from "node:fs";
import path from "node:path";

// Les tests d'intégration serveur tapent une vraie base Postgres locale (docker compose) :
// on charge le .env du monorepo pour DATABASE_URL / DATABASE_APP_URL si présent.
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// M13 — les tests tournent toujours sans worker séparé : on force le pilote
// `inline` (traitement synchrone, pas de Redis requis) quelle que soit la
// valeur de `.env` (qui vise `pnpm dev`/prod avec `apps/worker`).
process.env.IMPORT_QUEUE_DRIVER = "inline";
