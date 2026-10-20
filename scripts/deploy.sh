#!/usr/bin/env bash
# Étape 7.2 — mise à jour : sauvegarde, images, migrations, bascule si /api/health est vert.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker/docker-compose.prod.yml"
export ATELIEROS_VERSION="${ATELIEROS_VERSION:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"

required_vars=(POSTGRES_PASSWORD POSTGRES_APP_PASSWORD REDIS_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY ENCRYPTION_KEY AUTH_SECRET)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
for name in "${required_vars[@]}"; do
  if [ -z "${!name:-}" ]; then
    echo "ERREUR: variable ${name} manquante dans .env" >&2
    exit 1
  fi
done

echo "=== Déploiement AtelierOS (${ATELIEROS_VERSION}) ==="

echo "→ [0/6] Services de données (postgres, redis, minio)..."
docker compose -f "${COMPOSE_FILE}" up -d --wait postgres redis minio
docker compose -f "${COMPOSE_FILE}" run --rm minio-init

echo "→ [1/6] Sauvegarde préventive..."
bash scripts/backup.sh

echo "→ [2/6] Construction des images web, worker, migrate..."
docker compose -f "${COMPOSE_FILE}" --profile tools build web worker migrate

echo "→ [3/6] Migrations Prisma..."
docker compose -f "${COMPOSE_FILE}" --profile tools run --rm migrate

echo "→ [4/6] Mot de passe du rôle applicatif atelieros_app..."
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER:-atelieros}" -d "${POSTGRES_DB:-atelieros}" \
  -c "ALTER ROLE atelieros_app WITH PASSWORD '${POSTGRES_APP_PASSWORD}';"

echo "→ [5/6] Bascule web (santé obligatoire)..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps --wait web
HEALTHY=0
for i in $(seq 1 40); do
  if docker compose -f "${COMPOSE_FILE}" exec -T web \
    wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health 2>/dev/null; then
    HEALTHY=1
    break
  fi
  echo "  Attente de /api/health (${i}/40)..."
  sleep 3
done
if [ "${HEALTHY}" -eq 0 ]; then
  echo "ERREUR: /api/health n'a pas répondu, bascule annulée. L'ancien conteneur reste à inspecter." >&2
  docker compose -f "${COMPOSE_FILE}" logs --tail=80 web >&2
  exit 1
fi

echo "→ [6/6] Worker + Caddy..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps --wait worker
docker compose -f "${COMPOSE_FILE}" run --rm minio-init
if docker compose -f "${COMPOSE_FILE}" ps caddy --status running >/dev/null 2>&1; then
  docker compose -f "${COMPOSE_FILE}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile
else
  docker compose -f "${COMPOSE_FILE}" up -d caddy
fi

echo "=== Déploiement ${ATELIEROS_VERSION} terminé ==="
