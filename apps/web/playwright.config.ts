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
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
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
      // M15 : abonnement `fake` (changement d'offre appliqué immédiatement, aucun compte réel).
      // RG-M13-24 : pilote "inline" pour les imports, sans worker dédié. M14 RG-M14-06 : les
      // specs parallèles partagent une seule IP (127.0.0.1) ; quota par minute relevé en E2E.
      env: {
        ...process.env,
        IMPORT_QUEUE_DRIVER: "inline",
        PORTAL_RATE_LIMIT_PER_MINUTE: "600",
        SUBSCRIPTION_BILLING_PROVIDER: "fake",
      },
    },
    {
      command: "pnpm --filter @atelieros/worker dev",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
