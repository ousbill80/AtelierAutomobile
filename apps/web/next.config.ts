import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Monorepo : le `.env` vit à la racine, hors du dossier `apps/web` que Next.js
// charge automatiquement (même convention que `vitest.setup.ts`).
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
