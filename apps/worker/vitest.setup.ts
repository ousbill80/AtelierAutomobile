import { existsSync } from "node:fs";
import path from "node:path";

// Les tests d'intégration tapent une vraie base Postgres locale (docker compose) :
// on charge le .env du monorepo pour DATABASE_URL / DATABASE_APP_URL / REDIS_URL si présent.
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// M17 — aucun test n'appelle un vrai modèle : fournisseur IA `console` (déterministe) forcé,
// même si `.env` contient une clé ANTHROPIC_API_KEY.
process.env.AI_PROVIDER = "console";
