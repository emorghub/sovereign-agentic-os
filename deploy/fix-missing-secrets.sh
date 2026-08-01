#!/usr/bin/env bash
# Create the Secrets the chart REFERENCES but never CREATES.
#
# Idempotent + additive. Safe to re-run. Nothing here is Helm-owned, which is deliberate:
# Helm must not adopt (and therefore later delete) these.
#
# WHY THIS EXISTS — three instances of the same upstream chart defect:
#
#   1. dagster-postgresql / postgresql-password
#      values.yaml sets `dagster.postgresqlSecretName: dagster-postgresql` while
#      `dagster.postgresql.enabled: false` disables the bundled Bitnami postgres subchart
#      that would have created that Secret. The umbrella instead creates
#      `postgres-dagster-credentials` with keys username/password — a NAME *and* KEY mismatch.
#      Symptom: 4 dagster pods stuck CreateContainerConfigError,
#               `Error: secret "dagster-postgresql" not found`.
#
#   2. airflow-secrets / openmetadata-airflow-password
#      The OpenMetadata subchart injects AIRFLOW_PASSWORD unconditionally, even when
#      `pipelineServiceClientConfig.enabled: false` (values.yaml:1939, "no Airflow ingestion
#      locally") and no Airflow is deployed. The value is never read — it only has to exist.
#      Symptom: openmetadata stuck Init:CreateContainerConfigError,
#               `Error: secret "airflow-secrets" not found`.
#
#   3. registry-pull-secret  (0.6.x only — protected, not created, see below)
#      0.6.x stopped creating it and assumes External Secrets materialises it
#      (values.yaml:128). We don't run ESO. The `agentic-os` copy is not Helm-owned so it
#      survives, but the sandbox/workbench copies ARE Helm-owned and get deleted on upgrade,
#      breaking terminal/sandbox launches with ImagePullBackOff on our private GHCR.
#
# Same family as upstream issue #10 (mail-tls "created by nothing").
#
# Usage:  ./deploy/fix-missing-secrets.sh [namespace] [kube-context]

set -euo pipefail
NS="${1:-agentic-os}"
CTX="${2:-emagos}"
K="kubectl --context ${CTX} -n ${NS}"

echo "namespace=${NS} context=${CTX}"

# --- 1. dagster-postgresql -----------------------------------------------------------
if $K get secret dagster-postgresql >/dev/null 2>&1; then
  echo "  [skip] dagster-postgresql already exists"
else
  PW="$($K get secret postgres-dagster-credentials -o jsonpath='{.data.password}' | base64 -d)"
  [ -n "$PW" ] || { echo "  [FAIL] postgres-dagster-credentials has no password"; exit 1; }
  $K create secret generic dagster-postgresql --from-literal=postgresql-password="$PW"
  echo "  [ok] dagster-postgresql created (password copied from postgres-dagster-credentials)"
fi

# --- 2. airflow-secrets --------------------------------------------------------------
if $K get secret airflow-secrets >/dev/null 2>&1; then
  echo "  [skip] airflow-secrets already exists"
else
  # Value is never read: pipelineServiceClient is disabled and no Airflow is deployed.
  PW="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  $K create secret generic airflow-secrets --from-literal=openmetadata-airflow-password="$PW"
  echo "  [ok] airflow-secrets created (inert value — no Airflow here)"
fi

# --- 3. protect registry-pull-secret from Helm deletion on 0.6.x upgrades -------------
for sns in "${NS}-sandbox" "${NS}-workbench"; do
  if kubectl --context "${CTX}" -n "$sns" get secret registry-pull-secret >/dev/null 2>&1; then
    kubectl --context "${CTX}" -n "$sns" annotate secret registry-pull-secret \
      helm.sh/resource-policy=keep --overwrite >/dev/null
    echo "  [ok] ${sns}/registry-pull-secret annotated resource-policy=keep"
  else
    echo "  [warn] ${sns}/registry-pull-secret MISSING — copy it from ${NS} or sandbox/terminal launches will ImagePullBackOff"
  fi
done

echo
echo "Restart anything that was stuck:"
echo "  kubectl --context ${CTX} -n ${NS} delete pod -l app.kubernetes.io/name=openmetadata"
echo "  kubectl --context ${CTX} -n ${NS} get pods | grep dagster | awk '{print \$1}' | xargs -r kubectl --context ${CTX} -n ${NS} delete pod"
