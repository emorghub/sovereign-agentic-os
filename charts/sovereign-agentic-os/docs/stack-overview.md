# Stack Overview 

## Overview

Sovereign Agentic OS ships two deployment profiles on top of the same Helm
chart:

- The **base stack** (`values.base.yaml`) — a minimal, agent-core-only
  profile for local Kind development.
- The **full self-contained stack** (`values.selfcontained.yaml`) — every
  extension bundled, for a complete demo/evaluation environment.

## Base Stack

`values.base.yaml` provides a minimal local deployment profile for Sovereign
Agentic OS on a Kind cluster, targeting the **Agent golden path**.

It enables the core services required for the local base golden path:
LiteLLM (+ `litellmAgentKey`), Langfuse (+ its backends), Postgres,
ClickHouse, Valkey, object storage (MinIO), OPA, OS UI, mock-model, and
Forgejo (agent builds need repository storage — the OS UI's Build path
writes the built repository there) — enough to build and run an agent
end-to-end without any external dependency.

It disables optional extensions and additional Helm dependencies not
required for the base deployment: OpenSearch + Dashboards, Dagster,
OpenMetadata, Superset, Argo CD, Layer-4 Science, and every
`templates/extensions/*` guard. `queryTool` is also kept disabled — it
depends on the Trino/Polaris lakehouse stack, and wiring that up would push
the resource footprint well past what a local Kind node targets (see the
`queryTool` comment block in `values.base.yaml` for the full trade-off).

This keeps the deployment suitable for local Kind development (~3.2 GiB
resource usage) without external dependencies.

### Base image-build behavior

`scripts/build-images.sh`'s default (no-flags) build matches the base
stack's actual image requirements — it only builds images the base profile
uses:

```bash
./scripts/build-images.sh agentic-os
```

Builds: `mock-model:0.1.1`, `agent-runtime:0.1.2`, and `os-ui` (the latter
unconditional).

## Full Self-Contained Stack

The full self-contained stack (`values.selfcontained.yaml`) enables the base
stack's services plus every optional extension — OpenSearch, Dagster,
OpenMetadata, Superset, Argo CD, Layer-4 Science, and the rest of
`templates/extensions/*`.

`./install.sh --defaults` is the supported full-stack entry point. It
installs with `values.selfcontained.yaml` and automatically invokes the
extension image build path for you.

### Extension image-build behavior

```bash
./scripts/build-images.sh agentic-os --with-extensions
```

Additionally builds the optional extension images, including
`egress-proxy:0.1.0`, `web-fetch:0.1.0`, `mcp-test-agent:0.1.0`,
`data-runner:0.2.1`, and the other existing extension images.

`egress-proxy`, `web-fetch`, and `mcp-test-agent` were moved from
`BASE_IMAGES` to `EXT_IMAGES` because they are disabled (`enabled: false`) in
`values.base.yaml` — they aren't part of the base stack, only the full
stack.

## Model Usage (LiteLLM)

Both the base stack and the full self-contained stack default to a local
mock model (`mock-model`, routed via `litellm.proxy_config.model_list`), so
they run entirely locally with no external API credentials required. Either
profile can be repointed at a real OpenAI-compatible model endpoint instead.

### Base stack

In `values.base.yaml`, under `litellm.proxy_config.model_list`, uncomment
the real-model configuration block for each `sovereign-*` alias you want to
repoint (`sovereign-default`, `sovereign-mock`, `sovereign-reasoning`), and
configure the gateway endpoint (`api_base`) and model name (`model`) for
your LiteLLM-compatible gateway. Configure the LiteLLM master API key in
`values.yaml` (`litellmMasterKey`).

Changing model/API configuration is a runtime configuration change — it does
**not** require rebuilding Docker images. After configuring the endpoint and
credentials, update the deployment with:

```bash
helm upgrade --install agentic-os charts/sovereign-agentic-os \
  -f charts/sovereign-agentic-os/values.base.yaml \
  --namespace agentic-os
```

### Full stack

The same `litellm.proxy_config.model_list` mechanism applies. Re-apply
configuration changes through the supported entry point:

```bash
./install.sh --defaults
```

## Updating Runtime Configuration

If you change an API key or other Helm-configured runtime value, re-apply
the Helm configuration rather than rebuilding images:

```bash
helm upgrade --install agentic-os charts/sovereign-agentic-os \
  -f charts/sovereign-agentic-os/values.base.yaml \
  --namespace agentic-os
```

Then verify the workloads:

```bash
kubectl get pods -n agentic-os
```

If the affected workload doesn't automatically restart and pick up the
updated configuration, restart it (`kubectl rollout restart deployment/...`).

## Step-by-Step Guides

For the actual commands to run either stack locally on Kind, see the
companion [Quickstart Guide](quickstart-kind.md):

- Base stack → follow the base golden-path steps in `quickstart-kind.md`.
- Full stack → follow the "Full stack" section in `quickstart-kind.md`.
