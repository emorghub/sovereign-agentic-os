# Quickstart: Base Golden Path on Kind

Bring up the Phase 2.2 base golden-path slice (LiteLLM, Langfuse, Postgres,
ClickHouse, Valkey, MinIO, OpenSearch-free agent-core stack, OS UI, Forgejo)
on a local Kind cluster.

Assumes the repo is already cloned and checked out.

## 1. Prerequisites

- Docker Desktop, running, with **at least 6 GiB memory** allocated to the
  Docker VM (less risks the Kind node OOM-killing pods during boot)
- [Kind](https://kind.sigs.k8s.io/)
- `kubectl`
- Helm v3.22+

## 2. Create a Kind cluster

The repo ships a Kind cluster config (`kind-config.yaml`) that enables
containerd's `certs.d` registry config (needed later if you pull images from
Forgejo's in-cluster registry). The project's cluster name is `agentic-os`.

```bash
kind create cluster --name agentic-os --config kind-config.yaml
```

## 3. Build and load local images

Three images are **repo-owned** and must be built locally and loaded into the
Kind cluster. All other components in the base slice (Postgres, ClickHouse,
Valkey, MinIO, OPA, Langfuse, LiteLLM, Forgejo, etc.) use upstream images
pulled automatically by the Helm chart — nothing else to build.

```bash
# mock-model (context: images/base/mock-model)
docker build -t sovereign-os/mock-model:0.1.1 images/base/mock-model
kind load docker-image sovereign-os/mock-model:0.1.1 --name agentic-os

# agent-runtime (context: images/base/agent-runtime)
docker build -t sovereign-os/agent-runtime:0.1.2 images/base/agent-runtime
kind load docker-image sovereign-os/agent-runtime:0.1.2 --name agentic-os

# os-ui (context: repo root — it COPYs os-ui/ + docs/components)
docker build -t sovereign-os/os-ui:0.1.0 -f images/base/os-ui/Dockerfile .
kind load docker-image sovereign-os/os-ui:0.1.0 --name agentic-os
```

> `scripts/build-images.sh` automates this (and the other, non-base-slice
> bespoke images) if you'd rather run one script.

## 4. Helm dependencies

The umbrella chart's subchart archives (`charts/sovereign-agentic-os/charts/*.tgz`)
are **not tracked in Git** (`.gitignore` excludes `*.tgz`), so you must fetch
them before installing:

```bash
helm dependency build charts/sovereign-agentic-os
```

## 5. Install the base stack

`values.base.yaml` is a full allowlist that enables just the agent-core base
slice (LiteLLM, Langfuse + backends, mock-model, OPA, OS UI, Postgres,
ClickHouse, Valkey, object storage, Forgejo) and explicitly disables every
extension (OpenSearch, Dagster, OpenMetadata, Superset, Argo CD, Layer-4
Science, and all `templates/extensions/*` components).

```bash
helm install agentic-os charts/sovereign-agentic-os \
  -f charts/sovereign-agentic-os/values.base.yaml \
  --namespace agentic-os --create-namespace
```

## 6. Verify the deployment

```bash
helm list -A
kubectl get pods -n agentic-os
```

Watch until every base-slice pod reaches `1/1 Running`:

```bash
kubectl get pods -n agentic-os -w
```

## 7. Access the UIs

Each command runs a blocking port-forward — use a separate terminal per
service.

```bash
# OS UI
kubectl -n agentic-os port-forward svc/os-ui 3000:3000
```
→ http://localhost:3000

```bash
# Langfuse
kubectl -n agentic-os port-forward svc/agentic-os-langfuse-web 3001:3000
```
→ http://localhost:3001

```bash
# LiteLLM
kubectl -n agentic-os port-forward svc/agentic-os-litellm 4000:4000
```
→ http://localhost:4000

## 8. Teardown

```bash
kind delete cluster --name agentic-os
```
