# Sovereign Agentic OS

A self-hosted, governed operating system for AI agents. Agents run in
`agent-runtime`, reach models through LiteLLM, reach tools over MCP, are
authorized by OPA, and are traced in Langfuse — all fronted by one web app,
the **OS UI**. It ships as one umbrella Helm chart
(`charts/sovereign-agentic-os`) and as a Docker Compose stack for local work.

The repo draws one boundary: **base** — the smallest set the OS needs to boot
and demonstrate its core promise (a governed agent, talking to a governed
model, over a governed data path, with tracing) — and **extensions**
(a.k.a. experimental): everything opt-in, bespoke, or still proving itself.
See [`experimental/README.md`](experimental/README.md) for the policy.

## Run the base in 2 minutes

<!-- TODO(#22): compose.yaml + compose/README.md land with PR #42 -->

Needs only Docker. Runs fully offline — `mock-model` serves chat and
embeddings, so no model API key and no Kubernetes cluster.

```bash
cp .env.example .env
docker compose up
```

1. Wait for `docker compose ps` to show every service healthy.
2. Open **http://localhost:3000** and sign in as `admin` / `admin`.
3. **Agents** tab → **SimpleBuilder** → create a system → **Build** → **Run**.
4. Open the **Monitoring** tab to see the trace.

| Service  | URL                   | Login                                                    |
|----------|-----------------------|----------------------------------------------------------|
| OS UI    | http://localhost:3000 | `admin` / `admin`                                        |
| Forgejo  | http://localhost:3001 | `gitea_admin` / `forgejo-admin-local-dev`                |
| Langfuse | http://localhost:3002 | `alex@datamasterclass.com` / `langfuse-local-dev-admin`  |

Compose covers the **Agents golden path only**: `os-ui`, `agent-runtime` and
`mock-model`, plus OPA, LiteLLM, Langfuse and Forgejo. It does not run
`egress-proxy`, `web-fetch` or `mcp-test-agent`, and the Knowledge, Files,
Data, Metrics, Dashboards, Software, Components and Console tabs show empty or
unavailable. For those, run the full platform (below).

Profiles, external LiteLLM/Langfuse, real models and teardown:
[`compose/README.md`](compose/README.md).

## Run on Kubernetes

Both paths need `docker` (running), `kind`, `kubectl` and `helm`.

### Base only, on kind

<!-- TODO(#23): values.base.yaml + quickstart-kind.md land with PR #46 -->

Helm v3.22+, ≥ 6 GiB memory for the Docker VM.

```bash
kind create cluster --name agentic-os --config kind-config.yaml
./scripts/build-images.sh            # builds + loads the repo-owned images
helm dependency build charts/sovereign-agentic-os
helm install agentic-os charts/sovereign-agentic-os \
  -n agentic-os --create-namespace \
  -f charts/sovereign-agentic-os/values.base.yaml
```

Step-by-step: [`charts/sovereign-agentic-os/docs/quickstart-kind.md`](charts/sovereign-agentic-os/docs/quickstart-kind.md).

### Full platform (base + extensions)

~14 GB / 6 CPU for the Docker VM.

```bash
kind create cluster --name agentic-os   # or let install.sh create it
./install.sh                            # Enter through every prompt = fully self-contained
```

`./install.sh --defaults` runs non-interactively; `./install.sh --uninstall`
removes it. The wizard can point any backend at a managed/external service
instead. Presets: `values.selfcontained.yaml` (default),
`values.stackit-managed.yaml`.

Open the OS UI:

```bash
kubectl -n agentic-os port-forward svc/os-ui 8080:3000
```

**First sign-in (Helm installs):** `admin` / `admin` works only once — you are
forced to set a real user and strong password, and verifying your email deletes
the bootstrap admin for good. Then generate a master recovery key under
**Users → Account recovery** and store it offline. Details in the
[user guide](docs/Sovereign-Agentic-OS-Guide.md).

Deploying to STACKIT: [`docs/stackit-deployment-guide.md`](docs/stackit-deployment-guide.md).

## Repo map

The folders are the source of truth; this table is a snapshot.

| Path | What lives there |
|---|---|
| `images/base/` | Base images (below) |
| `images/extensions/` | Everything else: BI/analytics, Science/ML, developer tooling, sample agents |
| `charts/sovereign-agentic-os/templates/base/` | Base chart templates: agent-runtime, litellm, langfuse, mock-model, opa, os-ui, postgres, clickhouse, valkey, object-storage, network, example-agents |
| `charts/sovereign-agentic-os/templates/extensions/` | Extension chart templates |
| `os-ui/` | The OS UI (Next.js) — see [`os-ui/ARCHITECTURE.md`](os-ui/ARCHITECTURE.md) |
| `compose.yaml`, `compose/` | Docker Compose stack |
| `experimental/` | Base vs extensions policy + re-entry checklist |
| `docs/` | User guide, deployment guides, component docs |
| `scripts/` | Build, install and dev helpers |

Base images:

| Image | Role |
|---|---|
| `os-ui` | Front door — web app and the governed MCP registry (`/api/mcp`) |
| `agent-runtime` | Executes agent systems |
| `mock-model` | Offline OpenAI-compatible chat + embeddings stub |
| `egress-proxy` | Single outbound chokepoint, deny-by-default allowlist |
| `web-fetch` | Governed web-fetch tool (OPA-authorized, routed via the proxy) |
| `mcp-test-agent` | Demo agent proving the MCP registry works end to end |

## Where next

- [`docs/development.md`](docs/development.md) — contributor dev guide <!-- TODO(#24) -->
- [`os-ui/ARCHITECTURE.md`](os-ui/ARCHITECTURE.md) — how the OS UI is layered
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to send a change
- [`docs/Sovereign-Agentic-OS-Guide.md`](docs/Sovereign-Agentic-OS-Guide.md) — full user guide

## License

- **Core — Apache-2.0.** The OS UI, integration glue, bespoke images and the
  Helm chart — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
- **Bundled components keep their own licenses** — see
  [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md),
  [`licenses/`](licenses/) and the SBOM [`sbom.cdx.json`](sbom.cdx.json).
  Forgejo (GPL-3.0-or-later) ships as a separate service.
- **Enterprise features**, if any, live under [`ee/`](ee/) with their own license.
- **Contributions** are accepted into the Apache-2.0 core under the project
  CLA — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
- "Sovereign Agentic OS" and "Data Masterclass" are trademarks of Borek Data
  Ventures UG. Not affiliated with or endorsed by the Apache Software Foundation.