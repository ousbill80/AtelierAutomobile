import { existsSync } from "node:fs";
import path from "node:path";

// Les tests de synchronisation tapent une vraie base Postgres locale (docker compose) :
// on charge le .env du monorepo pour DATABASE_URL / DATABASE_APP_URL si présent.
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
