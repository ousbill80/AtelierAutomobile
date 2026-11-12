#!/usr/bin/env bash
# Déploiement d'AtelierOS depuis le poste de développement.
#
# Synchronise le dépôt vers le serveur, puis y lance scripts/deploy-swap.sh :
# la nouvelle version démarre à côté de celle qui sert et ne reçoit du trafic
# qu'une fois saine, donc sans coupure. ATELIEROS_DEPLOY=edge retombe sur
# deploy-edge.sh, qui recrée l'instance unique (coupure de 30 à 60 s).
#
# Le dépôt GitHub étant privé et le serveur n'ayant pas d'accès en lecture
# dessus, le code est poussé d'ici plutôt que tiré par un `git pull`. Pour
# rendre le serveur autonome, ajouter sa clé de déploiement sur GitHub
# (voir ~/.ssh/atelieros_deploy.pub côté serveur) — ce script reste alors
# utile pour déployer un travail non encore poussé.
#
# Usage :
#   ./scripts/deploy-remote.sh                 # hôte par défaut
#   ATELIEROS_SSH_HOST=autre-hote ./scripts/deploy-remote.sh
#   ./scripts/deploy-remote.sh --dry-run       # montre ce qui serait transféré
#
# L'hôte est un alias de ~/.ssh/config : c'est lui qui porte l'utilisateur et
# la clé privée, jamais ce script.
set -euo pipefail

SSH_HOST="${ATELIEROS_SSH_HOST:-cei-prod}"
REMOTE_DIR="${ATELIEROS_REMOTE_DIR:-/opt/atelieros}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "=== SIMULATION : rien ne sera modifié sur ${SSH_HOST} ==="
fi

# Ces chemins vivent sur le serveur et n'existent pas dans le dépôt. Les
# exclure les protège aussi de --delete : sans cela, la première
# synchronisation effacerait les secrets et les sauvegardes.
EXCLUDES=(
  --exclude '.git'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude '.turbo'
  --exclude '.env'                 # secrets de production
  --exclude 'backups/'             # sauvegardes chiffrées
  --exclude '.dev-outbox-password'
  # Ancré à la racine : un simple '*.sql' emporterait aussi les
  # packages/db/prisma/migrations/*/migration.sql, et Prisma échouerait au
  # déploiement suivant sur un dossier de migration vide (P3015).
  --exclude '/*.sql'               # dumps déposés à la main à la racine
  --exclude '*.log'
)

echo "=== Déploiement AtelierOS → ${SSH_HOST}:${REMOTE_DIR} ==="
echo "    révision locale : $(git rev-parse --short HEAD 2>/dev/null || echo inconnue)"

if ! git diff --quiet HEAD 2>/dev/null; then
  echo "    ATTENTION : modifications non commitées — elles seront déployées."
fi

echo
echo "→ [1/3] Vérification de l'accès SSH..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "${SSH_HOST}" true 2>/dev/null; then
  echo "ERREUR: connexion impossible à « ${SSH_HOST} »." >&2
  echo "        Vérifier l'alias dans ~/.ssh/config (HostName, User, IdentityFile)." >&2
  exit 1
fi
echo "    ok"

echo
echo "→ [2/3] Synchronisation du code..."
# -v seulement en simulation : sinon la liste complète noierait la sortie.
rsync -az --delete ${DRY_RUN:+--verbose} ${DRY_RUN} "${EXCLUDES[@]}" -e ssh ./ "${SSH_HOST}:${REMOTE_DIR}/"
echo "    ok"

if [ -n "${DRY_RUN}" ]; then
  echo
  echo "=== Simulation terminée : aucun déploiement lancé. ==="
  exit 0
fi

echo
echo "→ [3/3] Déploiement sur le serveur..."
REMOTE_SCRIPT="scripts/deploy-swap.sh"
[ "${ATELIEROS_DEPLOY:-swap}" = "edge" ] && REMOTE_SCRIPT="scripts/deploy-edge.sh"

# La révision est calculée ICI et transmise au serveur. Le dossier .git n'est
# pas synchronisé : laissé à lui-même, le serveur lirait son propre .git, figé
# à la révision du premier transfert, et /api/health annoncerait une version
# qui n'est pas celle du code déployé.
REVISION="$(git rev-parse --short HEAD 2>/dev/null || echo dev)"
git diff --quiet HEAD 2>/dev/null || REVISION="${REVISION}-modifie"

ssh "${SSH_HOST}" "cd ${REMOTE_DIR} && ATELIEROS_VERSION='${REVISION}' bash ${REMOTE_SCRIPT}"

echo
echo "=== Vérification ==="
ssh "${SSH_HOST}" "cd ${REMOTE_DIR} && docker compose --env-file .env \
  -f docker/docker-compose.prod.yml -f docker/docker-compose.edge.yml \
  ps --format '{{.Service}}\t{{.Status}}'" 2>/dev/null | grep -E 'web|worker' || true
echo
