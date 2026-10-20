#!/usr/bin/env bash
# Étape 7.2 — dump PostgreSQL custom (-Fc), chiffrement AES-256-CBC, copie hors serveur.
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
mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
BACKUP_NAME="atelieros_db_${TIMESTAMP}"
RAW_DUMP="${BACKUP_DIR}/${BACKUP_NAME}.dump"
ENCRYPTED_FILE="${BACKUP_DIR}/${BACKUP_NAME}.dump.enc"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.prod.yml"
PG_USER="${POSTGRES_USER:-atelieros}"
PG_DB="${POSTGRES_DB:-atelieros}"
KEY="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"

if [ -z "${KEY}" ]; then
  echo "ERREUR: BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY doit être définie." >&2
  exit 1
fi

echo "→ [1/4] Dump PostgreSQL (format custom compressé)..."
if [ -f "${COMPOSE_FILE}" ] && command -v docker >/dev/null 2>&1; then
  docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    pg_dump -U "${PG_USER}" -d "${PG_DB}" -Fc -Z 9 > "${RAW_DUMP}"
elif [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "${DATABASE_URL}" -Fc -Z 9 -f "${RAW_DUMP}"
else
  echo "ERREUR: ni compose de production ni DATABASE_URL." >&2
  exit 1
fi

if [ ! -s "${RAW_DUMP}" ]; then
  echo "ERREUR: dump vide, sauvegarde annulée." >&2
  rm -f "${RAW_DUMP}"
  exit 1
fi

echo "→ [2/4] Chiffrement AES-256-CBC (pbkdf2, 100 000 itérations)..."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -in "${RAW_DUMP}" \
  -out "${ENCRYPTED_FILE}" \
  -pass "pass:${KEY}"
rm -f "${RAW_DUMP}"
sha256sum "${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"
echo "✓ Sauvegarde créée : ${ENCRYPTED_FILE} ($(du -h "${ENCRYPTED_FILE}" | cut -f1))"

ACCESS_KEY="${S3_ACCESS_KEY:-}"
SECRET_KEY="${S3_SECRET_KEY:-}"
if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${ACCESS_KEY}" ] && [ -n "${SECRET_KEY}" ]; then
  echo "→ [3/4] Copie hors serveur vers ${S3_BUCKET}/backups..."
  if command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID="${ACCESS_KEY}" AWS_SECRET_ACCESS_KEY="${SECRET_KEY}" \
      aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${ENCRYPTED_FILE}" \
      "s3://${S3_BUCKET}/backups/${BACKUP_NAME}.dump.enc"
    AWS_ACCESS_KEY_ID="${ACCESS_KEY}" AWS_SECRET_ACCESS_KEY="${SECRET_KEY}" \
      aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${ENCRYPTED_FILE}.sha256" \
      "s3://${S3_BUCKET}/backups/${BACKUP_NAME}.dump.enc.sha256"
  else
    echo "Avertissement: aws CLI absent, copie S3 ignorée." >&2
  fi
else
  echo "→ [3/4] Copie hors serveur ignorée (S3_ENDPOINT / S3_BUCKET / clés manquants)."
fi

echo "→ [4/4] Rotation locale (> 30 jours)..."
find "${BACKUP_DIR}" -type f -name "atelieros_db_*.dump.enc*" -mtime +30 -delete
echo "✓ Sauvegarde terminée."
