#!/usr/bin/env bash
# Étape 7.2 — déchiffre la dernière sauvegarde et la restaure dans une base éphémère.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ -f "${ROOT_DIR}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
KEY="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.prod.yml"
PG_USER="${POSTGRES_USER:-atelieros}"
TARGET_FILE="${1:-$(find "${BACKUP_DIR}" -name "atelieros_db_*.dump.enc" | sort | tail -n 1)}"
TEST_DB="atelieros_restore_test_$$"

if [ -z "${TARGET_FILE}" ] || [ ! -f "${TARGET_FILE}" ]; then
  echo "ERREUR: aucune sauvegarde chiffrée dans ${BACKUP_DIR}." >&2
  exit 1
fi
if [ -z "${KEY}" ]; then
  echo "ERREUR: BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY requise." >&2
  exit 1
fi

echo "=== Test de restauration : ${TARGET_FILE} ==="

if [ -f "${TARGET_FILE}.sha256" ]; then
  echo "→ [1/4] Empreinte SHA-256..."
  (cd "$(dirname "${TARGET_FILE}")" && sha256sum -c "$(basename "${TARGET_FILE}.sha256")")
else
  echo "→ [1/4] Pas de fichier .sha256, étape ignorée."
fi

TMP_DUMP="$(mktemp /tmp/atelieros_restore_XXXXXX.dump)"
cleanup() {
  rm -f "${TMP_DUMP}"
  if [ -f "${COMPOSE_FILE}" ] && command -v docker >/dev/null 2>&1; then
    docker compose -f "${COMPOSE_FILE}" exec -T postgres \
      psql -U "${PG_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "→ [2/4] Déchiffrement..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -in "${TARGET_FILE}" \
  -out "${TMP_DUMP}" \
  -pass "pass:${KEY}"

echo "→ [3/4] Catalogue de l'archive..."
if command -v pg_restore >/dev/null 2>&1; then
  TABLE_COUNT="$(pg_restore -l "${TMP_DUMP}" | grep -c "TABLE DATA" || true)"
elif command -v docker >/dev/null 2>&1; then
  TABLE_COUNT="$(docker run --rm -v "${TMP_DUMP}:/dump.dump:ro" postgres:16-alpine \
    pg_restore -l /dump.dump | grep -c "TABLE DATA" || true)"
else
  echo "ERREUR: pg_restore ou docker requis." >&2
  exit 1
fi

if [ "${TABLE_COUNT}" -eq 0 ]; then
  echo "ERREUR: aucune table dans l'archive." >&2
  exit 1
fi
echo "  ${TABLE_COUNT} tables de données."

echo "→ [4/4] Restauration dans la base éphémère ${TEST_DB}..."
if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "Avertissement: compose de production absent, validation catalogue seulement."
  echo "✓ Test de restauration RÉUSSI (catalogue)."
  exit 0
fi

docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${PG_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${TEST_DB};"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${PG_USER}" -d postgres -c "CREATE DATABASE ${TEST_DB};"
docker compose -f "${COMPOSE_FILE}" exec -T postgres \
  pg_restore -U "${PG_USER}" -d "${TEST_DB}" --no-owner --no-acl < "${TMP_DUMP}"

echo "✓ Test de restauration RÉUSSI : ${TABLE_COUNT} tables, base ${TEST_DB} puis détruite."
