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

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // M11 (RG-M11-01) : l'envoi réel passe par la file BullMQ, traitée par apps/worker — sans
  // lui, un message reste QUEUED pour toujours et n'apparaît jamais dans /dev/outbox.
  webServer: [
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // RG-M13-24 : pilote "inline" (traitement synchrone, sans worker séparé)
      // pour que le serveur de prod lancé par Playwright traite les imports
      // sans dépendre d'un process `apps/worker` distinct.
      env: { ...process.env, IMPORT_QUEUE_DRIVER: "inline" },
    },
    {
      command: "pnpm --filter @atelieros/worker dev",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
