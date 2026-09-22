# Quickstart: Local Deployment on Kind

Bring up the Phase 2.2 base golden-path slice (LiteLLM, Langfuse, Postgres,
ClickHouse, Valkey, MinIO, OpenSearch-free agent-core stack, OS UI, Forgejo)
on a local Kind cluster.


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

`scripts/build-images.sh` automates this if you'd rather run one script. Its
default (no flags) build is **base-only** — it builds exactly the three
images above (mock-model, agent-runtime, and os-ui, the latter unconditional)
and nothing else:

```bash
./scripts/build-images.sh agentic-os
```

Extension images (used by the full self-contained stack, not the base
profile) are only built when `--with-extensions` is passed — see
[Full stack](#full-stack) below.

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

## 8. Full stack

The steps above bring up the **base profile** only. To run the full
self-contained stack (all extensions — OpenSearch, Dagster, OpenMetadata,
Superset, Argo CD, Layer-4 Science, and the rest of `templates/extensions/*`)
instead, use the supported full-stack entry point. It starts after creating
the Kind cluster:

```bash
kind create cluster --name agentic-os
```

On a first-time/fresh checkout, where the chart's subchart dependencies
(`charts/sovereign-agentic-os/charts/*.tgz`) aren't already present, fetch
them first:

```bash
helm dependency build charts/sovereign-agentic-os
```

Then run the supported full-stack entry point:

```bash
./install.sh --defaults
```

This installs with `values.selfcontained.yaml` and automatically invokes the
extension image build path (`scripts/build-images.sh --with-extensions`) for
you — you don't need to build extension images yourself first.

If you need to build or reload the extension images separately (for example,
to iterate on one without re-running the full installer), the same command
`install.sh` uses is also available directly:

```bash
./scripts/build-images.sh agentic-os --with-extensions
```

## 9. Updating an existing base cluster

After changing Helm values for a running base release, re-apply them with:

```bash
helm upgrade --install agentic-os charts/sovereign-agentic-os \
  -f charts/sovereign-agentic-os/values.base.yaml \
  --namespace agentic-os
```

```bash
kubectl get pods -n agentic-os
```

### Example: updating an API key

If you change an API key or other Helm-configured runtime value in
`values.base.yaml`, you do not need to rebuild the Docker images — this is a
runtime configuration change, so `build-images.sh` is not required.

For example, after updating the configured API key, re-apply the Helm
values:

```bash
helm upgrade --install agentic-os charts/sovereign-agentic-os \
  -f charts/sovereign-agentic-os/values.base.yaml \
  --namespace agentic-os
```

Then verify the workloads:

```bash
kubectl get pods -n agentic-os
```

If the affected application does not automatically restart and pick up the
updated configuration, restart the affected deployment:

```bash
kubectl rollout restart deployment/<deployment-name> -n agentic-os
```

> **Security note:** do not commit real API keys or other credentials to
> `values.yaml` or `values.base.yaml`. For production/STACKIT deployments,
> use the repository's supported secret-management / External Secrets
> mechanism.

## 10. Teardown

```bash
kind delete cluster --name agentic-os
```
