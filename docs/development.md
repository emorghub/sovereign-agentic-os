<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Development guide

Everything you need to go from a fresh clone to a merged pull request. Read it top
to bottom once; after that, jump to the section you need.

- How the code is organised: [`os-ui/ARCHITECTURE.md`](../os-ui/ARCHITECTURE.md)
- Building apps *on* the OS rather than contributing to it:
  [`docs/developer-mode.md`](developer-mode.md)

## 1. Prerequisites

| Tool | Needed for | Version |
|---|---|---|
| git, Node.js, npm | Everything | Node **22.18+** — pinned in `os-ui/.nvmrc` <!-- TODO(#25): .nvmrc lands with PR #43 --> |
| Docker | Mode 2 and Mode 3 | Mode 3: give the Docker VM **≥ 6 GiB** memory |
| kind, kubectl, Helm | Mode 3 | Helm **3.22+** |
| `opa` | Policy tests | OPA **1.x** |
| Python 3.11 + `pytest` | Only if you change an image's Python code | pytest 8.x |
| `gitleaks`, `syft` | Optional local secret / SBOM scans | — |

On Windows, work inside WSL2.

## 2. First-time setup

```bash
git clone https://github.com/emorghub/sovereign-agentic-os.git
cd sovereign-agentic-os/os-ui
nvm use          # reads os-ui/.nvmrc (or install Node 22.18+ another way)
npm ci
```

Run every `npm` / `npx` command in this guide from `os-ui/` unless it says
otherwise. `npm test` refuses to start until `npm ci` has run.
<!-- TODO(#25): pretest guard lands with PR #43 -->

## 3. Pick a run mode

| Mode | Use it when | Needs | Model calls |
|---|---|---|---|
| **1. `npm run dev`** (offline) | Working on os-ui pages, routes or `lib/` — fastest reload | Node | None |
| **2. `docker compose`** | Running the full agent golden path end to end | Docker | `mock-model` |
| **3. kind + `values.base.yaml`** | Working on the Helm chart or anything Kubernetes-specific | Docker, kind, Helm | `mock-model` |

### Mode 1 — `npm run dev` (offline)

```bash
cd os-ui
OPA_FAIL_OPEN=true npm run dev
```

Open <http://localhost:3000>:

1. Sign in as `admin` / `admin`.
2. You are forced to create a real user: username, email and a strong password.
3. A verification link is shown on screen (nothing is emailed locally) — open it.

What to expect:

- **Works:** sign-in, every tab loads, creating an agent system, grants, **Build**.
- **Empty:** tabs have no data — offline mode ships no demo data.
- **Fails:** anything that needs a model, e.g. the in-app assistant. Use Mode 2 for that.
- **Not kept:** users and data live in memory. Restarting `npm run dev` resets them —
  see [Known traps](#7-known-traps).
- The first visit to each page compiles it on demand and can take 5–25 s.

`OPA_FAIL_OPEN=true` lets governed actions through while no OPA is running. Use it
only for this offline mode — never against a real cluster.

### Mode 2 — `docker compose` base stack

<!-- TODO(#22): compose.yaml + compose/README.md land with PR #42 -->

From the repo root:

```bash
cp .env.example .env
docker compose up
```

Open <http://localhost:3000> and sign in as `admin` / `admin` (a seeded user — no
forced setup). The first `up` builds three images and pulls the rest, so expect
several minutes.

- Rebuild after changing os-ui code: `docker compose up -d --build os-ui`
- Profiles, external LiteLLM/Langfuse, real models, teardown:
  [`compose/README.md`](../compose/README.md)

The repo has **two** `.env.example` files: the root one configures Compose; the one in
`os-ui/` is for [pointing `npm run dev` at a cluster](#4-point-npm-run-dev-at-a-cluster).

### Mode 3 — `values.base.yaml` on kind

<!-- TODO(#23): values.base.yaml + quickstart-kind.md land with PR #46 -->

Follow [`charts/sovereign-agentic-os/docs/quickstart-kind.md`](../charts/sovereign-agentic-os/docs/quickstart-kind.md).
In short, from the repo root:

```bash
kind create cluster --name agentic-os --config kind-config.yaml
# build + kind-load mock-model, agent-runtime and os-ui (commands in the quickstart)
helm dependency build charts/sovereign-agentic-os
helm install agentic-os charts/sovereign-agentic-os \
  -n agentic-os --create-namespace \
  -f charts/sovereign-agentic-os/values.base.yaml
kubectl -n agentic-os get pods -w      # wait for every pod to be Running
```

- `scripts/build-images.sh` also works, but it builds **every** image (extensions
  too) and silently ignores `kind load` failures. For the base profile, the three
  `docker build` + `kind load` commands in the quickstart are faster.
- First sign-in follows the same forced-setup flow as Mode 1.
- Profile details and the `values.yaml` fixes behind it:
  [`charts/sovereign-agentic-os/docs/base-profile.md`](../charts/sovereign-agentic-os/docs/base-profile.md)

## 4. Point `npm run dev` at a cluster

Mode 1's fast reload against real backends from a Mode 3 (or full-platform) cluster.

<!-- TODO(#25): os-ui/.env.example lands with PR #43 -->

```bash
cd os-ui
cp .env.example .env.local      # .env.local is gitignored
```

Open a tunnel for each backend you need, then set the matching variable in
`.env.local`. Local ports use a `1xxxx` scheme so nothing collides with
`npm run dev` on `3000`.

| Service | Cluster port | Local port | Variable | In base profile |
|---|---|---|---|---|
| `agentic-os-litellm` | 4000 | 14000 | `LITELLM_URL` | ✅ |
| `opa` | 8181 | 18181 | `OPA_URL` | ✅ |
| `agentic-os-langfuse-web` | 3000 | 13000 | `LANGFUSE_URL` | ✅ |
| `forgejo-http` | 3000 | 19300 | `FORGEJO_URL` | ✅ |
| `agent-runtime` | 8000 | 18002 | `AGENT_RUNTIME_URL` | ✅ |
| `minio` (S3) | 9000 | 19000 | `S3_ENDPOINT` | ✅ |
| `opensearch` | 9200 | 19200 | `OPENSEARCH_URL` | — full platform |
| `query-tool` | 8000 | 18000 | `QUERY_TOOL_URL` | — |
| `sample-agent` | 8000 | 18001 | `SAMPLE_AGENT_URL` | — |
| `agentic-os-dagster-webserver` | 80 | 13070 | `DAGSTER_URL` | — |
| `data-runner` | 8000 | 18003 | `DATA_RUNNER_URL` | — |
| `cube` | 4000 | 14001 | `CUBE_URL` | — |
| `docling` | 5001 | 15001 | `DOCLING_URL` | — |

Tunnels for the base profile:

```bash
kubectl -n agentic-os port-forward svc/agentic-os-litellm      14000:4000 &
kubectl -n agentic-os port-forward svc/opa                     18181:8181 &
kubectl -n agentic-os port-forward svc/agentic-os-langfuse-web 13000:3000 &
kubectl -n agentic-os port-forward svc/forgejo-http            19300:3000 &
kubectl -n agentic-os port-forward svc/agent-runtime           18002:8000 &
kubectl -n agentic-os port-forward svc/minio                   19000:9000 &
```

Credentials come from cluster Secrets:

```bash
kubectl -n agentic-os get secret <name> -o go-template='{{ .data.<KEY> | base64decode }}'
```

| Variable | Secret | Key |
|---|---|---|
| `LITELLM_MASTER_KEY` | `litellm-credentials` | `masterkey` |
| `LANGFUSE_SECRET_KEY` | `langfuse-init` | `LANGFUSE_INIT_PROJECT_SECRET_KEY` |
| `FORGEJO_PASSWORD` | `forgejo-admin` | `password` |
| `AGENT_RUNTIME_TOKEN` | `agent-runtime-token` | `token` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | `object-storage-credentials` | see `os-ui/.env.example` |

Rules:

- **Leave `OS_PUBLIC_URL` empty.** The cluster's value scopes the session cookie to
  its public hostname; on localhost, sign-in returns 200 and then bounces you back to
  `/signin`.
- **Do not set `OPA_FAIL_OPEN`** here. With a real OPA, authorization fails closed.
- The base profile does not run OpenSearch, which `os-ui/.env.example` lists as
  required. Tabs backed by OpenSearch need the full platform.
- Every variable, with comments: `os-ui/.env.example`. Console-link variables
  (`SUPERSET_URL`, `*_CONSOLE_URL`, …): [`os-ui/INTEGRATION.md`](../os-ui/INTEGRATION.md).

## 5. Before you push

| Check | Command | Run from | ~Time | CI job <!-- TODO(#31): typecheck, lint, policy and the test job name come with PR #44; main currently runs test-ui, build, test-python, helm-lint, secret-scan --> |
|---|---|---|---|---|
| Type-check | `npx tsc --noEmit` | `os-ui/` | 45 s | `typecheck` |
| Unit tests | `npm test` | `os-ui/` | 3 min | `test` |
| Build | `npm run build` | `os-ui/` | 2.5 min | `build` |
| Lint | `npm run lint` | `os-ui/` | 50 s | `lint` <!-- TODO(#31) --> |
| Policy tests | `bash scripts/policy-test.sh` | repo root | seconds | `policy` <!-- TODO(#31) --> |
| Helm | `helm dependency build charts/sovereign-agentic-os && helm lint charts/sovereign-agentic-os` | repo root | seconds | `helm-lint` |
| SPDX headers | `bash scripts/add-spdx-headers.sh --check` | repo root | seconds | `license-gate` |
| Licenses | `bash scripts/license-check.sh --no-syft` | repo root | seconds | `license-gate` |
| npm licenses | `npm run check:licenses` | `os-ui/` | seconds | `build` |
| Secrets | `gitleaks detect --source . --log-opts "origin/main..HEAD" --redact` | repo root | seconds | `secret-scan` |

**Always run type-check, build and tests together.** `tsc` alone misses server-only
and Edge-runtime leaks that only `next build` catches, and import side effects that
only the test suite catches.

If you changed an image's Python code, run its suite from the repo root
(Python 3.11, `pip install "pytest>=8,<9"`) — the same steps as the `test-python` CI job:

```bash
pip install -r images/extensions/data-runner/requirements.txt
python3 -m pytest -q images/extensions/data-runner/test_app.py
python3 -m pytest -q images/base/web-fetch/test_app.py
pip install -r images/base/agent-runtime/requirements.txt
python3 -m pytest -q images/base/agent-runtime/tests/
python3 images/extensions/query-tool/test_execute_guard.py   # not in CI yet — added by PR #44
```

CI runs on pull requests that target `main`.

## 6. Contribution workflow

The rules live in [`CONTRIBUTING.md`](../CONTRIBUTING.md); this is the step-by-step.

### CLA

Contributions are accepted under the project CLA, not a DCO — do not add
`Signed-off-by` lines. Read [`CLA.md`](../CLA.md). On your **first** pull request the
CLA Assistant check fails until you comment:

```
I have read the CLA Document and I hereby sign the CLA
```

This is one-time: later pull requests pass automatically. Contributing for an
employer? See the Corporate CLA section of `CONTRIBUTING.md`.

### SPDX headers

Every new source file carries an SPDX header. CI checks `.py` and `.sh` files only;
os-ui TypeScript/JavaScript is not checked automatically.

- **`.py` and `.sh`** under `images/`, `scripts/` and `install.sh`: run
  `bash scripts/add-spdx-headers.sh` to add it, `--check` to verify.
- **os-ui TypeScript / JavaScript**: the script skips `os-ui/`; add it by hand:

  ```ts
  /* SPDX-License-Identifier: Apache-2.0
   * Copyright 2026 Borek Data Ventures UG
   */
  ```

### License allowlist

- **New npm dependency:** `npm run check:licenses` must pass; the allowlist is in
  `os-ui/package.json`.
- **New bundled component** (an image or chart dependency we redistribute): add a
  row to `licenses/components.tsv`. Its SPDX id must be in
  `licenses/allowed-licenses.txt`; anything in `licenses/denied-licenses.txt`
  (ELv2, BSL, SSPL, …) fails the gate. Keep
  [`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) in step.
- `bash scripts/license-check.sh --update-sbom` regenerates `sbom.cdx.json` (needs `syft`).

## 7. Known traps

- **`npx tsc` from the repo root** downloads an unrelated npm package called `tsc`.
  Run it from `os-ui/`, or from the root:
  `npx --prefix os-ui tsc --noEmit -p os-ui/tsconfig.json`.
- **`npm run lint` opens an ESLint setup prompt** until
  `os-ui/eslint.config.mjs` lands — choose *Cancel* and don't commit a generated config.
  <!-- TODO(#31): eslint.config.mjs lands with PR #44 -->
- **Offline restart resets users.** Your browser cookie survives, so you may see
  "Welcome back …" followed by the setup form. Use a private window, or clear cookies
  for `localhost:3000`.
- **Port 3000 is shared** by `npm run dev`, the Compose `os-ui` and the kind
  quickstart's port-forward. Run one at a time, or forward to another local port.
- **OPA fails closed.** An unreachable OPA or a broken policy looks exactly like a
  real denial. In Compose, check `docker compose logs opa`.
- **Compose profiles:** run `docker compose down` before changing `COMPOSE_PROFILES`;
  after changing an env var, `docker compose up -d --force-recreate os-ui`.
- **npm 11 `allow-scripts` warnings** for `sharp` and `core-js` during `npm ci` do not
  block dev, tests or build.
- **Windows:** use WSL2. The repo forces LF line endings (`.gitattributes`); CRLF
  checkouts fail byte-for-byte fixture tests. <!-- TODO(#25) -->
- **WSL2 + kind with a real model:** if pods cannot resolve external hosts, point
  CoreDNS's `forward` at a public resolver.

## 8. Where next

- [`os-ui/ARCHITECTURE.md`](../os-ui/ARCHITECTURE.md) — layering rules and the tab-module contract
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — contribution rules
- [`experimental/README.md`](../experimental/README.md) — base vs extensions policy
- [`README.md`](../README.md) — what the OS is and how to run it