#!/usr/bin/env bash
# Attend le service S3 (moto, émulateur compatible S3) puis crée le bucket de l'application.
# Le code ne crée pas le bucket lui-même. `PUT /<bucket>` est idempotent sur moto.
# (MinIO n'est plus publié sur Docker Hub depuis 2025 : `minio/minio` renvoie 404.)
set -euo pipefail
endpoint="${S3_ENDPOINT:-http://localhost:9000}"
bucket="${S3_BUCKET:-atelieros-dev}"
for _ in $(seq 1 30); do
  curl -sf "${endpoint}/moto-api/" >/dev/null && break
  sleep 1
done
curl -sf -X PUT "${endpoint}/${bucket}" >/dev/null
echo "Bucket ${bucket} prêt sur ${endpoint}"
