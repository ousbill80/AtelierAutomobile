import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Monorepo : le `.env` vit à la racine (même convention que `vitest.setup.ts` / `next.config.ts`).
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
    env: { PORT: port },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
