#!/usr/bin/env bash
# Mise à jour d'AtelierOS derrière un reverse proxy déjà en place.
#
# Variante de deploy.sh pour un serveur mutualisé : les ports 80/443 y
# appartiennent à un nginx commun à plusieurs projets, donc le Caddy du compose
# de production est inactif (docker/docker-compose.edge.yml) et ce script ne
# touche jamais au proxy.
#
# nginx n'a pas besoin d'être rechargé après un déploiement : sa configuration
# vise AtelierOS par un alias réseau résolu à chaque requête (`resolver` +
# variable dans proxy_pass), et non par une IP figée au chargement.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE=(docker compose --env-file .env
  -f docker/docker-compose.prod.yml
  -f docker/docker-compose.edge.yml)

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

# En APP_ENV=production, aucun code de vérification ne peut partir sans canal
# plateforme : personne ne pourrait s'inscrire ni se connecter d'un nouvel
# appareil. En recette les codes restent lisibles dans /dev/outbox.
if [ "${APP_ENV:-}" = "production" ] \
  && [ -z "${PLATFORM_EMAIL_PROVIDER:-}" ] \
  && [ -z "${PLATFORM_SMS_PROVIDER:-}" ] \
  && [ -z "${PLATFORM_WHATSAPP_PHONE_ID:-}" ]; then
  echo "ERREUR: APP_ENV=production sans canal plateforme (PLATFORM_EMAIL_*, PLATFORM_SMS_*," >&2
  echo "        PLATFORM_WHATSAPP_*) : les codes de vérification ne partiraient pas." >&2
  echo "        Voir docs/exploitation.md §2." >&2
  exit 1
fi

echo "=== Déploiement AtelierOS (${ATELIEROS_VERSION}) ==="

echo "→ [1/6] Services de données (postgres, redis, minio)..."
"${COMPOSE[@]}" up -d --wait postgres redis minio

# Le bucket est un répertoire de premier niveau sous /data : `minio/mc`, qui
# servait à le créer, n'est plus distribué publiquement (401 sur Docker Hub,
# 410 sur dl.min.io). MinIO reconnaît le répertoire comme bucket — ce que
# /api/health vérifie ensuite par HeadBucket.
echo "→ [2/6] Bucket ${S3_BUCKET:-atelieros-production}..."
"${COMPOSE[@]}" exec -T minio mkdir -p "/data/${S3_BUCKET:-atelieros-production}"

echo "→ [3/6] Sauvegarde préventive..."
bash scripts/backup.sh

echo "→ [4/6] Construction des images web, worker, migrate..."
"${COMPOSE[@]}" --profile tools build web worker migrate

echo "→ [5/6] Migrations Prisma, puis mot de passe du rôle applicatif..."
"${COMPOSE[@]}" --profile tools run --rm migrate
# Mot de passe passé via stdin (heredoc), jamais dans l'argv de psql (`ps aux`).
sql_app_password=${POSTGRES_APP_PASSWORD//\'/\'\'}
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-atelieros}" -d "${POSTGRES_DB:-atelieros}" -v ON_ERROR_STOP=1 <<SQL
ALTER ROLE atelieros_app WITH PASSWORD '${sql_app_password}';
SQL

echo "→ [6/6] Bascule web et worker (santé obligatoire)..."
"${COMPOSE[@]}" up -d --no-deps --wait web
HEALTHY=0
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" exec -T web \
    wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health 2>/dev/null; then
    HEALTHY=1
    break
  fi
  echo "  Attente de /api/health (${i}/40)..."
  sleep 3
done
if [ "${HEALTHY}" -eq 0 ]; then
  echo "ERREUR: /api/health n'a pas répondu, bascule interrompue." >&2
  "${COMPOSE[@]}" logs --tail=80 web >&2
  exit 1
fi
"${COMPOSE[@]}" up -d --no-deps --wait worker

echo "=== Déploiement ${ATELIEROS_VERSION} terminé ==="
echo "    https://${APP_DOMAIN:-atelier.prodestic.net}/api/health"
