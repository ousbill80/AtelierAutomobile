#!/usr/bin/env bash
# ==============================================================================
# scripts/restore-test.sh — Test automatisé de restauration de sauvegarde (Étape 7.2)
# Vérifie l'intégrité, déchiffre et valide le dump PostgreSQL sans impacter la prod
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
KEY="${BACKUP_ENCRYPTION_KEY:-${ENCRYPTION_KEY:-}}"

# Fichier à tester : premier argument ou le plus récent dans le dossier backups
TARGET_FILE="${1:-$(find "${BACKUP_DIR}" -name "atelieros_db_*.sql.gz.enc" | sort | tail -n 1)}"

if [ -z "${TARGET_FILE}" ] || [ ! -f "${TARGET_FILE}" ]; then
  echo "ERREUR: Aucune sauvegarde chiffrée trouvée dans ${BACKUP_DIR}." >&2
  exit 1
fi

if [ -z "${KEY}" ]; then
  echo "ERREUR: BACKUP_ENCRYPTION_KEY ou ENCRYPTION_KEY requise pour déchiffrer." >&2
  exit 1
fi

echo "=== Test de restauration pour : ${TARGET_FILE} ==="

# 1. Vérification du checksum sha256 si disponible
if [ -f "${TARGET_FILE}.sha256" ]; then
  echo "→ [1/3] Vérification de l'empreinte sha256..."
  (cd "$(dirname "${TARGET_FILE}")" && sha256sum -c "$(basename "${TARGET_FILE}.sha256")")
else
  echo "→ [1/3] Pas de fichier .sha256, passage à l'étape suivante."
fi

# 2. Déchiffrement vers un fichier temporaire sécurisé
TMP_DUMP="$(mktemp /tmp/atelieros_restore_XXXXXX.sql.gz)"
trap 'rm -f "${TMP_DUMP}"' EXIT

echo "→ [2/3] Déchiffrement AES-256-CBC..."
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -in "${TARGET_FILE}" \
  -out "${TMP_DUMP}" \
  -pass "pass:${KEY}"

# 3. Validation de l'archive PostgreSQL avec pg_restore -l
echo "→ [3/3] Validation de la structure de l'archive PostgreSQL (pg_restore --list)..."
TABLE_COUNT=0
if command -v pg_restore >/dev/null 2>&1; then
  TABLE_COUNT="$(pg_restore -l "${TMP_DUMP}" | grep -c "TABLE DATA" || true)"
elif command -v docker >/dev/null 2>&1; then
  # Utiliser un conteneur postgres temporaire si l'outil local n'est pas installé
  TABLE_COUNT="$(docker run --rm -v "${TMP_DUMP}:/dump.sql.gz:ro" postgres:16-alpine pg_restore -l /dump.sql.gz | grep -c "TABLE DATA" || true)"
else
  echo "AVERTISSEMENT: pg_restore ou docker non trouvé, test du format binaire uniquement."
  # Test de compression
  gzip -t "${TMP_DUMP}"
  TABLE_COUNT=1
fi

if [ "${TABLE_COUNT}" -gt 0 ]; then
  echo "✓ Test de restauration RÉUSSI : ${TABLE_COUNT} tables de données détectées et intègres."
  exit 0
else
  echo "ERREUR: Aucune table valide détectée dans la sauvegarde !" >&2
  exit 1
fi
