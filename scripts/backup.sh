#!/usr/bin/env bash
# ==============================================================================
# scripts/backup.sh — Sauvegarde quotidienne chiffrée de PostgreSQL (Étape 7.2)
# Dump pg_dump -> compression gzip -> chiffrement AES-256-CBC -> transfert S3 / disque
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Charger l'environnement si présent
if [ -f "${ROOT_DIR}/.env" ]; then
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
fi

BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
BACKUP_NAME="atelieros_db_${TIMESTAMP}"
RAW_DUMP="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz"
ENCRYPTED_FILE="${BACKUP_DIR}/${BACKUP_NAME}.sql.gz.enc"

PG_CONTAINER="${PG_CONTAINER:-atelieros-prod-postgres-1}"
PG_USER="${POSTGRES_USER:-atelieros}"
PG_DB="${POSTGRES_DB:-atelieros}"
KEY="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"

if [ -z "${KEY}" ]; then
  echo "ERREUR: BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY doit être définie pour chiffrer la sauvegarde." >&2
  exit 1
fi

echo "→ [1/4] Dump PostgreSQL et compression gzip..."
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
  docker exec "${PG_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" -F c -Z 9 > "${RAW_DUMP}"
elif [ -n "${DATABASE_URL:-}" ]; then
  pg_dump "${DATABASE_URL}" -F c -Z 9 -f "${RAW_DUMP}"
else
  echo "ERREUR: Ni conteneur Docker '${PG_CONTAINER}' ni DATABASE_URL accessible." >&2
  exit 1
fi

echo "→ [2/4] Chiffrement AES-256-CBC avec pbkdf2..."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -in "${RAW_DUMP}" \
  -out "${ENCRYPTED_FILE}" \
  -pass "pass:${KEY}"

# Suppression du fichier brut non chiffré
rm -f "${RAW_DUMP}"

# Génération d'une empreinte sha256 pour intégrité
sha256sum "${ENCRYPTED_FILE}" > "${ENCRYPTED_FILE}.sha256"

echo "✓ Sauvegarde créée : ${ENCRYPTED_FILE} ($(du -h "${ENCRYPTED_FILE}" | cut -f1))"

# Étape 3 : Export hors serveur (S3 si configuré)
if [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY_ID:-}" ]; then
  echo "→ [3/4] Transfert hors serveur vers S3 (${S3_BUCKET}/backups)..."
  if command -v aws >/dev/null 2>&1; then
    aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${ENCRYPTED_FILE}" "s3://${S3_BUCKET}/backups/${BACKUP_NAME}.sql.gz.enc" || true
    aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${ENCRYPTED_FILE}.sha256" "s3://${S3_BUCKET}/backups/${BACKUP_NAME}.sql.gz.enc.sha256" || true
  fi
else
  echo "→ [3/4] Export hors serveur ignoré (variables S3 non configurées)."
fi

# Étape 4 : Rotation locale (garde les 30 derniers jours)
echo "→ [4/4] Nettoyage des anciennes sauvegardes locales (> 30 jours)..."
find "${BACKUP_DIR}" -type f -name "atelieros_db_*.sql.gz.enc*" -mtime +30 -delete

echo "✓ Sauvegarde terminée avec succès."
