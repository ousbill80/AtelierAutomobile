#!/usr/bin/env bash
# Étape 2.5 — mise en route d'un poste de dev en une commande : `pnpm dev:setup`.
# Services docker (Postgres, Redis, MinIO + bucket, Mailpit), .env, dépendances,
# client Prisma, migrations et données de démo.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  key="$(openssl rand -base64 32)"
  secret="$(openssl rand -hex 32)"
  sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${key}|; s|^AUTH_SECRET=.*|AUTH_SECRET=${secret}|" .env
  rm -f .env.bak
  echo "→ .env créé depuis .env.example (clés générées)."
fi

docker compose -f docker/docker-compose.yml up -d --wait postgres redis minio mailpit
docker compose -f docker/docker-compose.yml up minio-init

pnpm install
pnpm --filter @atelieros/db exec prisma generate
pnpm db:migrate
pnpm db:seed

echo "✓ Prêt : lancez \`pnpm dev\` (web + worker), puis ouvrez http://localhost:3000"
