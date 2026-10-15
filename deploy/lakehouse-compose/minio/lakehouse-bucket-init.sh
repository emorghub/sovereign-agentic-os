#!/bin/sh
# One-shot (amazon/aws-cli, the same image the base minio-bucket-init uses): create
# the buckets the lakehouse needs, matching the chart's objectStorage.buckets:
#   lakehouse — Iceberg warehouse (Polaris base location s3://lakehouse/wh) AND the
#               data-runner / os-ui uploads bucket (dataRunner.uploadsBucket)
#   files     — Files-tab original bytes (os-ui FILES_BUCKET)
# The base compose's own init still creates `langfuse`. Idempotent.
set -e

echo "waiting for S3 endpoint $ENDPOINT ..."
i=1
while [ "$i" -le 60 ]; do
  if aws --endpoint-url "$ENDPOINT" s3 ls >/dev/null 2>&1; then echo "S3 endpoint is up"; break; fi
  i=$((i + 1))
  sleep 3
done

for b in lakehouse files; do
  if aws --endpoint-url "$ENDPOINT" s3 ls "s3://$b" >/dev/null 2>&1; then
    echo "bucket $b already exists"
  else
    echo "creating bucket $b"
    aws --endpoint-url "$ENDPOINT" s3 mb "s3://$b"
  fi
done
echo "lakehouse bucket init done"
