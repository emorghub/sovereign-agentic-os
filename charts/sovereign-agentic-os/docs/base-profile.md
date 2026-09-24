# Base Profile (Phase 2.2)

## Overview

`values.base.yaml` provides a minimal local deployment profile for Sovereign
Agentic OS on a Kind cluster, targeting the **Agent golden path**: LiteLLM,
Langfuse (+ its backends), Postgres, ClickHouse, Valkey, object storage
(MinIO), OPA, OS UI, mock-model, and Forgejo — enough to build and run an
agent end-to-end without any external dependency.

For step-by-step setup instructions, see the companion
[Quickstart Guide](quickstart-kind.md), which walks through creating the Kind
cluster, building the repo-owned images, fetching Helm dependencies, and
installing this profile.

## Files Created

### `values.base.yaml`

- Enables the core services required for the local base golden path:
  `agentRuntime`, `litellm`, `litellmAgentKey`, `langfuse`, `mockModel`,
  `opa`, `osUI`, `postgres`, `clickhouse`, `valkey`, `objectStorage`.
- Enables Forgejo because agent builds require repository storage — the OS
  UI's Build path writes the built repository there.
- Keeps the deployment suitable for local Kind (~3.2 GiB resource usage).
- Disables optional extensions and additional Helm dependencies not required
  for the base deployment (OpenSearch + Dashboards, Dagster, OpenMetadata,
  Superset, Argo CD, Layer-4 Science, and every `templates/extensions/*`
  guard).
- Keeps `queryTool` disabled because it depends on the Trino/Polaris
  lakehouse stack — wiring that up would increase the resource footprint well
  past what a local Kind node targets (see the `queryTool` comment block in
  `values.base.yaml` for the full trade-off).

### `quickstart-kind.md`

Also created in this directory as part of Phase 2.2. It provides a
step-by-step guide for deploying the base golden-path stack on a local Kind
cluster (prerequisites, cluster creation, image builds, Helm dependency
fetch, install, verification, UI access, teardown). It is referenced above
and is not duplicated or modified here.

## Files Modified

### `values.yaml`

The following infrastructure fixes were made during Kind validation of this
profile:

1. **MinIO image** — updated the image repository/digest
   (`objectStorage.image`). The original Docker Hub digest
   (`minio/minio@sha256:8834ae...`) was dead; it now points at
   `quay.io/minio/minio@sha256:c7175077d39a8cc10c9fd611cdcc68b6a5b365793e9ac6f4198ffff1ef0fe555`.
2. **Postgres readiness check** — added a `wait-for-postgres` initContainer
   (`litellm.extraInitContainers`) that loops on `pg_isready -h pg-rw -p 5432`
   before the LiteLLM schema migration runs. On a fresh cluster, Kubernetes
   gives no ordering guarantee between the Postgres StatefulSet and the
   LiteLLM Deployment, so the migration could previously start before
   Postgres was reachable.
3. **Migration sanity check** — set `ENFORCE_PRISMA_MIGRATION_CHECK=true` on
   the `db-migrate` initContainer, so a real migration failure now fails the
   container (and gets retried by Kubernetes) instead of silently exiting 0
   with the schema left missing.
4. **Migration memory limit** — increased the `db-migrate` initContainer's
   `resources.limits.memory` from `2Gi` to `3Gi`; the migration was
   reproducibly OOM-killed at the previous limit.

These changes address deployment issues found during Kind validation without
changing the overall application architecture.

## Local Real-LLM Testing

The default base profile uses mock models (`mock-model`, routed via
`litellm.proxy_config.model_list` in `values.base.yaml`) so the deployment
runs entirely locally, with no external API credentials required.

To test with a real LLM instead:

1. In `values.base.yaml`, under `litellm.proxy_config.model_list`, uncomment
   the real-model configuration block for each `sovereign-*` alias you want
   to repoint (`sovereign-default`, `sovereign-mock`, `sovereign-reasoning`),
   and configure the gateway endpoint (`api_base`) and model name (`model`)
   for your LiteLLM-compatible gateway.
2. Configure the LiteLLM master API key in `values.yaml`
   (`litellmMasterKey`)
3. **Never commit real API keys or credentials to the repository.** Supply
   them via a local, untracked values override or your secret manager of
   choice — not by editing the committed `api_key` placeholders in place.
