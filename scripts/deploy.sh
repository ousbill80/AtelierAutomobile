#!/usr/bin/env bash
# ==============================================================================
# scripts/deploy.sh — Déploiement et mise à jour sans coupure (Étape 7.2)
# Sauvegarde préalable -> Migration DB -> Build images -> Bascule saine avec healthcheck
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="docker/docker-compose.prod.yml"

echo "=== Déploiement AtelierOS en cours ==="

# 1. Sauvegarde préventive de la base de données
echo "→ [1/5] Sauvegarde préventive de la base de données..."
if [ -f "scripts/backup.sh" ]; then
  bash scripts/backup.sh || echo "Avertissement : la sauvegarde préventive a échoué mais le déploiement continue."
fi

# 2. Construction des nouvelles images Docker
echo "→ [2/5] Construction des nouvelles images (web, worker)..."
docker compose -f "${COMPOSE_FILE}" build web worker

# 3. Application des migrations de schéma Prisma
echo "→ [3/5] Application des migrations Prisma..."
if command -v pnpm >/dev/null 2>&1; then
  pnpm --filter @atelieros/db exec prisma migrate deploy
else
  docker compose -f "${COMPOSE_FILE}" run --rm web pnpm --filter @atelieros/db exec prisma migrate deploy
fi

# 4. Démarrage / mise à jour du service Web avec validation de santé
echo "→ [4/5] Démarrage du nouveau conteneur Web et attente de santé..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps web

# Attente de la sonde de santé HTTP (/api/health)
HEALTHY=0
for i in $(seq 1 30); do
  echo "  Attente de santé (${i}/30)..."
  if docker compose -f "${COMPOSE_FILE}" exec -T web wget --no-verbose --tries=1 --spider http://localhost:3000/api/health 2>/dev/null; then
    HEALTHY=1
    break
  fi
  sleep 2
done

if [ "${HEALTHY}" -eq 0 ]; then
  echo "ERREUR : Le conteneur Web ne répond pas sur /api/health après 60 secondes !" >&2
  exit 1
fi
echo "✓ Conteneur Web sain et opérationnel."

# 5. Mise à jour du Worker d'arrière-plan et rechargement Caddy
echo "→ [5/5] Mise à jour du Worker et rechargement Caddy..."
docker compose -f "${COMPOSE_FILE}" up -d --no-deps worker

# Recharger Caddy pour prendre en compte toute modification de config sans couper les connexions
if docker compose -f "${COMPOSE_FILE}" ps caddy | grep -q "Up"; then
  docker compose -f "${COMPOSE_FILE}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
else
  docker compose -f "${COMPOSE_FILE}" up -d caddy
fi

echo "=== Déploiement terminé avec succès ! ==="
