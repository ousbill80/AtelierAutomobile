#!/usr/bin/env bash
# =============================================================================
# deploy/backup.sh — sauvegarde quotidienne du site ONAD (Postgres + médias)
# =============================================================================
#
# À exécuter directement sur le VPS hôte (PAS dans un conteneur), via cron.
# Utilise `docker exec` / `docker cp` pour piloter les conteneurs Postgres et
# accéder au volume "uploads" depuis l'hôte : Docker doit donc être installé
# et l'utilisateur qui exécute ce script doit pouvoir lancer des commandes
# `docker` (ex: membre du groupe "docker").
#
# Ce que fait ce script :
#   1. Dump complet de la base PostgreSQL du conteneur "postgres"
#      (via pg_dump), compressé en .sql.gz, avec rotation (30 jours conservés)
#   2. Archive tar.gz du volume Docker "uploads" (médias Payload), avec la
#      même rotation
#   3. (Optionnel) Copie/synchronisation de ces sauvegardes vers un
#      emplacement distant via rsync, si BACKUP_REMOTE_PATH est défini
#
# Installation (cron quotidien à 3h du matin, exécuté par l'utilisateur
# courant) :
#   crontab -e
#   0 3 * * * /chemin/vers/onad-site/deploy/backup.sh >> /var/log/onad-backup.log 2>&1
#
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Configuration — adapter si besoin, ou surcharger via variables d'environnement
# -----------------------------------------------------------------------------

# Répertoire du projet (contient docker-compose.yml). Par défaut : dossier
# parent de deploy/, calculé automatiquement.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Si un fichier .env existe à la racine du projet (celui utilisé par
# docker-compose, voir .env.docker.example), on en importe les variables
# (POSTGRES_USER, POSTGRES_DB, ...) pour éviter toute divergence avec la
# configuration réelle. Les variables déjà présentes dans l'environnement
# d'exécution de ce script restent prioritaires (ex: si définies avant
# l'appel, ou directement dans la crontab).
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
    set +a
fi

# Nom du service docker-compose exécutant PostgreSQL (voir docker-compose.yml)
POSTGRES_SERVICE="${POSTGRES_SERVICE:-postgres}"

# Nom du volume Docker contenant les médias uploadés par Payload
# (voir docker-compose.yml -> volumes -> uploads)
UPLOADS_VOLUME="${UPLOADS_VOLUME:-onad_uploads}"

# Répertoire local où sont stockées les sauvegardes sur le VPS
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

# Nombre de jours de sauvegardes à conserver localement
RETENTION_DAYS="${RETENTION_DAYS:-30}"

# Emplacement distant optionnel (ex: utilisateur@serveur:/chemin/vers/backups)
# vers lequel synchroniser les sauvegardes via rsync. Laisser vide pour
# désactiver cette étape (sauvegarde locale uniquement).
BACKUP_REMOTE_PATH="${BACKUP_REMOTE_PATH:-}"

# Variables de connexion à la base (doivent correspondre au fichier .env
# utilisé par docker-compose ; voir .env.docker.example)
POSTGRES_USER="${POSTGRES_USER:-onad}"
POSTGRES_DB="${POSTGRES_DB:-onad_site}"

DATE="$(date +%Y-%m-%d)"

mkdir -p "$BACKUP_DIR"

echo "[backup.sh] $(date -Iseconds) — Démarrage de la sauvegarde"

# -----------------------------------------------------------------------------
# 1. Dump PostgreSQL
# -----------------------------------------------------------------------------
DB_DUMP_FILE="$BACKUP_DIR/${DATE}.sql.gz"

echo "[backup.sh] Dump de la base PostgreSQL ($POSTGRES_DB) -> $DB_DUMP_FILE"
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T "$POSTGRES_SERVICE" \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$DB_DUMP_FILE"

# -----------------------------------------------------------------------------
# 2. Archive du volume "uploads" (médias Payload)
# -----------------------------------------------------------------------------
UPLOADS_ARCHIVE="$BACKUP_DIR/${DATE}-uploads.tar.gz"

echo "[backup.sh] Archive du volume uploads ($UPLOADS_VOLUME) -> $UPLOADS_ARCHIVE"
docker run --rm \
    -v "${UPLOADS_VOLUME}:/data:ro" \
    -v "$BACKUP_DIR:/backup" \
    alpine:3 \
    tar -czf "/backup/$(basename "$UPLOADS_ARCHIVE")" -C /data .

# -----------------------------------------------------------------------------
# 3. Rotation locale — supprime les sauvegardes plus vieilles que RETENTION_DAYS
# -----------------------------------------------------------------------------
echo "[backup.sh] Rotation des sauvegardes locales (conservation : $RETENTION_DAYS jours)"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "*.sql.gz" -o -name "*-uploads.tar.gz" \) \
    -mtime +"$RETENTION_DAYS" -print -delete

# -----------------------------------------------------------------------------
# 4. Copie optionnelle vers un serveur distant (rsync)
# -----------------------------------------------------------------------------
if [ -n "$BACKUP_REMOTE_PATH" ]; then
    echo "[backup.sh] Synchronisation vers $BACKUP_REMOTE_PATH"
    rsync -az --delete-after "$BACKUP_DIR"/ "$BACKUP_REMOTE_PATH"/
else
    echo "[backup.sh] BACKUP_REMOTE_PATH non défini, synchronisation distante ignorée."
    echo "[backup.sh] Exemple d'utilisation :"
    echo "  BACKUP_REMOTE_PATH=backup-user@backup-server.example.com:/srv/backups/onad ./deploy/backup.sh"
    echo "  (nécessite un accès SSH par clé déjà configuré vers ce serveur)"
fi

echo "[backup.sh] $(date -Iseconds) — Sauvegarde terminée avec succès"
