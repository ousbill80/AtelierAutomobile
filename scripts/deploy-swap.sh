#!/usr/bin/env bash
# Déploiement sans coupure (blue-green) d'AtelierOS.
#
# La nouvelle version démarre à côté de celle qui sert le trafic et ne reçoit
# aucune requête tant qu'elle n'est pas saine. Recréer un conteneur unique,
# comme le fait deploy-edge.sh, laissait 30 à 60 s de 502 pendant le démarrage
# de Next.js.
#
# La bascule déplace l'alias réseau `atelieros-web`, que vise cei-nginx : la
# configuration du proxy, partagée par sept projets, n'est jamais modifiée par
# un déploiement.
#
# Si la nouvelle version ne devient pas saine, rien ne bascule : l'ancienne
# continue de servir et le script s'arrête en erreur. Un échec de déploiement
# n'a donc aucun effet visible.
#
# LIMITE À CONNAÎTRE — les deux versions coexistent quelques secondes sur la
# MÊME base. Les migrations doivent rester compatibles avec la version encore
# en service : ajouter une colonne, oui ; en supprimer ou en renommer une dans
# la même livraison fera échouer l'ancienne instance pendant la bascule.
# Procéder en deux livraisons (ajouter puis, plus tard, retirer).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE=(docker compose --env-file .env
  -f docker/docker-compose.prod.yml
  -f docker/docker-compose.edge.yml)

NETWORK="atelieros-prod_atelieros-network"
PUBLIC_ALIAS="atelieros-web"
# Doit dépasser le `valid=` du resolver nginx (10 s), sinon l'ancienne instance
# serait arrêtée alors que son IP est encore en cache.
DNS_GRACE="${DNS_GRACE:-15}"

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

if [ "${APP_ENV:-}" = "production" ] \
  && [ -z "${PLATFORM_EMAIL_PROVIDER:-}" ] \
  && [ -z "${PLATFORM_SMS_PROVIDER:-}" ] \
  && [ -z "${PLATFORM_WHATSAPP_PHONE_ID:-}" ]; then
  echo "ERREUR: APP_ENV=production sans canal plateforme : aucun code de" >&2
  echo "        vérification ne partirait. Voir docs/exploitation.md §2." >&2
  exit 1
fi

# Nom du conteneur d'une couleur, qu'il tourne ou non.
container_of() {
  "${COMPOSE[@]}" ps -a --format '{{.Name}}' "web-$1" 2>/dev/null | head -1
}

has_public_alias() {
  local ctn="$1"
  [ -n "${ctn}" ] || return 1
  docker inspect "${ctn}" \
    --format "{{range \$n,\$c := .NetworkSettings.Networks}}{{range \$c.Aliases}}{{.}} {{end}}{{end}}" 2>/dev/null \
    | tr ' ' '\n' | grep -qx "${PUBLIC_ALIAS}"
}

is_running() {
  [ -n "${1:-}" ] && [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

# Déplace l'alias public sur un conteneur. Le conteneur est déconnecté puis
# reconnecté : c'est la seule façon d'ajouter un alias à chaud. On ne l'applique
# qu'à une instance qui ne reçoit pas encore de trafic.
attach_alias() {
  local ctn="$1" svc="$2"
  docker network disconnect "${NETWORK}" "${ctn}" 2>/dev/null || true
  docker network connect --alias "${PUBLIC_ALIAS}" --alias "${svc}" "${NETWORK}" "${ctn}"
}

# Retire l'alias public d'une instance hors service. Sans cela, la couleur
# arrêtée le conserverait dans sa configuration réseau : un `docker compose
# up -d` la relancerait et elle recevrait du trafic avec une version périmée,
# à côté de la version courante.
detach_alias() {
  local ctn="$1" svc="$2"
  [ -n "${ctn}" ] || return 0
  docker network disconnect "${NETWORK}" "${ctn}" 2>/dev/null || true
  docker network connect --alias "${svc}" "${NETWORK}" "${ctn}" 2>/dev/null || true
}

wait_healthy() {
  local ctn="$1" i status
  for i in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "${ctn}" 2>/dev/null || echo "?")"
    case "${status}" in
      healthy) return 0 ;;
      unhealthy) echo "  état : unhealthy" >&2; return 1 ;;
    esac
    [ $((i % 5)) -eq 0 ] && echo "  attente de la sonde (${i}/60, état ${status})..."
    sleep 3
  done
  return 1
}

# ── Couleur en service ───────────────────────────────────────────
BLUE="$(container_of blue)"
GREEN="$(container_of green)"
LEGACY="$("${COMPOSE[@]}" ps -a --format '{{.Name}}' web 2>/dev/null | head -1)"

ACTIVE=""
if has_public_alias "${BLUE}" && is_running "${BLUE}"; then
  ACTIVE="blue"
elif has_public_alias "${GREEN}" && is_running "${GREEN}"; then
  ACTIVE="green"
fi

# Première bascule depuis l'instance unique d'origine (service `web`).
LEGACY_ACTIVE=""
if [ -z "${ACTIVE}" ] && has_public_alias "${LEGACY}" && is_running "${LEGACY}"; then
  LEGACY_ACTIVE="${LEGACY}"
fi

case "${ACTIVE}" in
  blue)  TARGET="green" ;;
  green) TARGET="blue" ;;
  *)     TARGET="blue" ;;
esac
TARGET_CTN_EXPECTED="web-${TARGET}"

echo "=== Déploiement sans coupure AtelierOS (${ATELIEROS_VERSION}) ==="
if [ -n "${ACTIVE}" ]; then
  echo "    en service : ${ACTIVE}  →  nouvelle version : ${TARGET}"
elif [ -n "${LEGACY_ACTIVE}" ]; then
  echo "    en service : instance d'origine (${LEGACY_ACTIVE})  →  nouvelle version : ${TARGET}"
else
  echo "    aucune instance en service  →  démarrage de ${TARGET}"
fi

echo
echo "→ [1/8] Services de données..."
"${COMPOSE[@]}" up -d --wait postgres redis minio
"${COMPOSE[@]}" exec -T minio mkdir -p "/data/${S3_BUCKET:-atelieros-production}"

echo
echo "→ [2/8] Sauvegarde préventive..."
bash scripts/backup.sh

echo
echo "→ [3/8] Construction des images..."
"${COMPOSE[@]}" --profile build-only --profile tools build web worker migrate

echo
echo "→ [4/8] Migrations Prisma..."
"${COMPOSE[@]}" --profile tools run --rm migrate
"${COMPOSE[@]}" exec -T postgres \
  psql -U "${POSTGRES_USER:-atelieros}" -d "${POSTGRES_DB:-atelieros}" \
  -c "ALTER ROLE atelieros_app WITH PASSWORD '${POSTGRES_APP_PASSWORD}';"

echo
echo "→ [5/8] Démarrage de ${TARGET} (hors trafic)..."
# --force-recreate : sans cela, un conteneur déjà présent avec l'ancienne image
# serait réutilisé tel quel et la nouvelle version ne serait jamais déployée.
"${COMPOSE[@]}" up -d --no-deps --force-recreate "${TARGET_CTN_EXPECTED}"
TARGET_CTN="$(container_of "${TARGET}")"

echo
echo "→ [6/8] Attente de la sonde de santé..."
if ! wait_healthy "${TARGET_CTN}"; then
  echo "ERREUR: ${TARGET} n'est pas devenu sain — aucune bascule." >&2
  echo "        L'instance en service n'a pas été touchée." >&2
  "${COMPOSE[@]}" logs --tail=60 "${TARGET_CTN_EXPECTED}" >&2
  "${COMPOSE[@]}" stop "${TARGET_CTN_EXPECTED}" >/dev/null 2>&1 || true
  exit 1
fi
echo "    ${TARGET} est sain."

echo
echo "→ [7/8] Bascule du trafic..."
attach_alias "${TARGET_CTN}" "${TARGET_CTN_EXPECTED}"
echo "    l'alias ${PUBLIC_ALIAS} désigne maintenant ${TARGET}."
echo "    attente de ${DNS_GRACE}s (expiration du cache DNS de nginx)..."
sleep "${DNS_GRACE}"

echo
echo "→ [8/8] Arrêt de l'ancienne instance et du worker..."
for old in "${ACTIVE:+web-${ACTIVE}}" "${LEGACY_ACTIVE:+web}"; do
  [ -n "${old}" ] || continue
  echo "    arrêt de ${old}"
  "${COMPOSE[@]}" stop "${old}" >/dev/null 2>&1 || true
  # L'alias n'est retiré qu'une fois l'instance arrêtée : elle ne sert plus
  # rien, la manipulation réseau est donc sans effet sur le trafic.
  old_ctn="$("${COMPOSE[@]}" ps -a --format '{{.Name}}' "${old}" 2>/dev/null | head -1)"
  detach_alias "${old_ctn}" "${old}"
done
# Le worker ne reçoit pas de trafic HTTP : BullMQ reprend les files au
# redémarrage, une courte interruption y est sans conséquence.
"${COMPOSE[@]}" up -d --no-deps --wait worker

echo
echo "=== Déploiement ${ATELIEROS_VERSION} terminé — couleur en service : ${TARGET} ==="
"${COMPOSE[@]}" exec -T "${TARGET_CTN_EXPECTED}" \
  wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null || true
echo
