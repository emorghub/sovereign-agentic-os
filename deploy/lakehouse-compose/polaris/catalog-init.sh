#!/bin/sh
# One-shot (curlimages/curl): register the `lakehouse` Iceberg catalog in Polaris.
# Same management-API calls as the chart's polaris-bootstrap.yaml
# (polaris-catalog-init Job). The realm bootstrap creates the realm + root principal
# but NOT the catalog; Trino and data-runner both use warehouse=lakehouse, so it must
# exist. Idempotent: an existing catalog that already has pathStyleAccess is a no-op.
set -eu

echo "waiting for Polaris to be ready ..."
ready=
for i in $(seq 1 60); do
  if curl -fsS "$POLARIS_MGMT/q/health/ready" >/dev/null 2>&1; then ready=1; break; fi
  sleep 5
done
[ -n "$ready" ] || { echo "ERROR: Polaris not ready"; exit 1; }

TOKEN=$(curl -fsS -X POST "$POLARIS_CATALOG_API/api/catalog/v1/oauth/tokens" \
  -d grant_type=client_credentials \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d scope=PRINCIPAL_ROLE:ALL \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo "ERROR: could not obtain Polaris token"; exit 1; }

code=$(curl -s -o /tmp/cat.json -w '%{http_code}' -H "Authorization: Bearer $TOKEN" \
  "$POLARIS_CATALOG_API/api/management/v1/catalogs/$CATALOG")
if [ "$code" = "200" ]; then
  if grep -q '"pathStyleAccess":true' /tmp/cat.json; then
    echo "catalog $CATALOG already registered with pathStyleAccess -- nothing to do"
    exit 0
  fi
  echo "ERROR: catalog $CATALOG exists without pathStyleAccess; this deployment only"
  echo "creates fresh catalogs. Run the README cleanup (down -v) and start again."
  exit 1
fi

echo "registering catalog $CATALOG -> $BASE_LOCATION"
curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "$POLARIS_CATALOG_API/api/management/v1/catalogs" \
  -d '{
    "catalog": {
      "name": "'"$CATALOG"'",
      "type": "INTERNAL",
      "properties": {
        "default-base-location": "'"$BASE_LOCATION"'",
        "s3.endpoint": "'"$S3_ENDPOINT"'",
        "s3.path-style-access": "true",
        "s3.region": "'"$S3_REGION"'",
        "s3.access-key-id": "'"$AWS_ACCESS_KEY_ID"'",
        "s3.secret-access-key": "'"$AWS_SECRET_ACCESS_KEY"'",
        "table-default.s3.endpoint": "'"$S3_ENDPOINT"'",
        "table-default.s3.path-style-access": "true",
        "table-default.s3.region": "'"$S3_REGION"'"
      },
      "storageConfigInfo": {
        "storageType": "S3",
        "roleArn": "arn:aws:iam::000000000000:role/polaris-lakehouse",
        "allowedLocations": ["'"$BASE_LOCATION"'", "'"$BASE_LOCATION"'/*"],
        "endpointInternal": "'"$S3_ENDPOINT"'",
        "pathStyleAccess": true
      }
    }
  }'
echo
echo "catalog $CATALOG registered"
