import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Charge le `.env` du monorepo (DATABASE_APP_URL, S3_*...) pour le serveur de
// prod lancé ci-dessous, comme `vitest.setup.ts` le fait pour les tests
// d'intégration — sans dépendre d'un shell qui l'aurait déjà sourcé.
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// Plusieurs sessions d'agent (worktrees) peuvent tourner en parallèle sur cette machine ; un
// port fixe ferait collisionner `pnpm test:e2e` avec le serveur dev d'une autre session.
// `E2E_PORT` permet à chaque session de choisir son port sans toucher au comportement par défaut.
const port = process.env.E2E_PORT ?? "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // RG-M13-24 : pilote "inline" (traitement synchrone, sans worker séparé)
    // pour que le serveur de prod lancé par Playwright traite les imports
    // sans dépendre d'un process `apps/worker` distinct.
    env: { ...process.env, PORT: port, IMPORT_QUEUE_DRIVER: "inline" },
  },
});
