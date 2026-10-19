#!/usr/bin/env bash
# Démarre MinIO (mêmes identifiants que docker/docker-compose.yml) et crée le bucket.
# Utilisé par la CI ; en local, `docker compose` s'en charge via le service minio-init.
set -euo pipefail
docker run -d --name minio -p 9000:9000 \
  -e MINIO_ROOT_USER="${S3_ACCESS_KEY:-atelieros}" \
  -e MINIO_ROOT_PASSWORD="${S3_SECRET_KEY:-atelieros123}" \
  minio/minio:latest server /data
for _ in $(seq 1 30); do
  curl -sf http://localhost:9000/minio/health/live >/dev/null && break
  sleep 1
done
docker run --rm --network host --entrypoint sh minio/mc:latest -c \
  "mc alias set local http://localhost:9000 '${S3_ACCESS_KEY:-atelieros}' '${S3_SECRET_KEY:-atelieros123}' \
   && mc mb --ignore-existing local/${S3_BUCKET:-atelieros-dev}"
