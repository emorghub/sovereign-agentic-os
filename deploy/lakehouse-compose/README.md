# Lakehouse Compose deployment (real Bronze → Silver → Gold)

A **separate** Docker Compose deployment of the Sovereign Agentic OS that adds the
real data plane the base `compose.yaml` deliberately leaves out:

| Service | Role | Source in this repo |
|---|---|---|
| `polaris` | Apache Polaris Iceberg REST catalog, **durable** (JDBC metastore on `pg-rw`) | chart `extensions/lakehouse/polaris.yaml` |
| `polaris-db-init`, `polaris-bootstrap`, `polaris-catalog-init` | one-shot: create the `polaris` DB, bootstrap the realm once, register the `lakehouse` catalog | chart `polaris.yaml` initContainers + `polaris-bootstrap.yaml` Job |
| `trino` | central governed engine: Iceberg → Polaris, OPA access control | chart `extensions/lakehouse/trino.yaml` |
| `data-runner` | real Bronze ingest: CSV in MinIO → Iceberg table via Polaris | `images/extensions/data-runner` (unchanged) |
| `query-tool` | governed SQL path os-ui reads/CTASes through, now pointed at Trino | `images/extensions/query-tool` (unchanged) |
| `cube`, `cube-model-sync` | semantic layer through Trino + sidecar pulling models from os-ui | chart `extensions/cube/cube.yaml` |
| `openmetadata`, `openmetadata-db-init`, `openmetadata-migrate` | OpenMetadata 1.13.0 catalog. os-ui's Silver/Gold/metric builds have a **hard** OpenMetadata step (`os-ui/lib/experimental/data/build/live.ts`), so the medallion can't register without it | chart dependency `openmetadata` 1.13.0 (vendored `charts/openmetadata-1.13.0.tgz`) + `values.yaml` `openmetadata.openmetadata.config` |
| `opensearch` | OpenMetadata's search backend; also os-ui's state mirror (default `OPENSEARCH_URL=http://opensearch:9200`) | chart dependency `opensearch` 3.7.0 + `values.yaml` `opensearch.*` |
| `lakehouse-bucket-init` | creates the `lakehouse` and `files` buckets in MinIO | chart `objectStorage.buckets` |

It is an **override** (`compose.lakehouse.yaml`) on top of the unchanged repo-root
`compose.yaml`, run as its **own Compose project** (`sovereign-lakehouse`) with its
**own env file**. It has separate containers, network, volumes and remapped host
ports, so it can run next to (or instead of) the default stack. Nothing outside
this directory is modified.

## How the medallion flow works here

1. **Bronze.** os-ui stores the CSV in `s3://lakehouse/uploads/<uid>/…`. `data-runner` writes
   the physical Iceberg table `iceberg.personal_<uid>.bronze_<slug>` through Polaris.
   os-ui registers Bronze only after the governed verify query passes.
2. **Silver.** os-ui sends a governed `CREATE OR REPLACE TABLE … AS SELECT` through
   `query-tool` → Trino (as the owner uid; OPA allows the owner's `personal_*` schema),
   then runs its OpenMetadata step, and only then registers Silver.
3. **Gold.** Continue / pass-through probes the real Bronze or Silver table and CTASes it into
   `gold_<slug>` (or authored SQL via the Refine / Gold-join panels), followed by the same
   OpenMetadata step.
4. `profile_dataset` / `query_data` read the same physical tables through Trino.

## Prerequisites

- Docker Engine with **Docker Compose ≥ 2.24** (`!override` / `!reset` tags). Check
  with `docker compose version`.
- About **12 GB RAM free** for this project: Trino heap 2 GB, OpenMetadata heap up to
  2 GB, OpenSearch 512 MB, plus os-ui, Polaris, Cube and Langfuse/ClickHouse. Both
  stacks together need more.
- Free host ports: 13000, 13001, 13002, 14000, 14040, 18000, 18080, 18181, 18585. All
  are configurable via `LH_*_PORT` in `.env`.
- Internet access on first start, to pull `apache/polaris`, `apache/polaris-admin-tool`,
  `trinodb/trino:476`, `cubejs/cube`, `curlimages/curl`,
  `docker.getcollate.io/openmetadata/server:1.13.0` and `opensearchproject/opensearch:3.7.0`
  (the chart's pinned versions).

## Configure

```sh
cp deploy/lakehouse-compose/.env.example deploy/lakehouse-compose/.env
```

Every value is a **local-dev placeholder**. Change the `*-change-me` values (Polaris
root secret, Polaris and OpenMetadata DB passwords, service bearer, Cube API secret,
session secret) for anything beyond a laptop. Also generate your own `OM_FERNET_KEY`:
the template ships the public default from the upstream OpenMetadata chart. The
repo-root `.env` is **not** read.

## Start

From the repo root, with either wrapper (each just runs `docker compose` with both
files and this env file):

```powershell
# Windows PowerShell
.\deploy\lakehouse-compose\lakehouse.ps1 up -d --build
```

```sh
# Linux / macOS / Git Bash
./deploy/lakehouse-compose/lakehouse.sh up -d --build
```

Or the equivalent raw command:

```sh
docker compose -f compose.yaml -f deploy/lakehouse-compose/compose.lakehouse.yaml \
  --env-file deploy/lakehouse-compose/.env up -d --build
```

The first start takes several minutes (image builds, Trino warm-up). Check progress with
`ps -a` (see Validate). Every long-running service should be `(healthy)`, except
`cube-model-sync`, which has no health check, and every one-shot `*-init` / `polaris-bootstrap`
should be `Exited (0)`.

Don't use `up --wait`: the base stack's `forgejo-init` one-shot exits 0 with nothing
depending on it, and Compose `--wait` reports that as a failure even when the deployment
is healthy.

Then open the OS UI at **http://localhost:13000** and sign in with the `OS_USERS` seed
user (`admin` / `admin` by default).

Start order, enforced with `depends_on`:
pg-rw → polaris-db-init → polaris-bootstrap → polaris (healthy) → (+ minio → lakehouse-bucket-init)
→ polaris-catalog-init → trino (healthy) → query-tool, data-runner, cube (healthy);
pg-rw → openmetadata-db-init → (+ opensearch healthy) → openmetadata-migrate → openmetadata (healthy);
all of those → os-ui (healthy) → cube-model-sync.

## Health checks test real readiness

| Service | Check | What it proves |
|---|---|---|
| `polaris` | `/q/health/ready` **and** an OAuth2 client-credentials token for the root principal | JDBC metastore up and realm usable |
| `trino` | `trino --execute "SHOW SCHEMAS FROM iceberg"` | engine + Polaris catalog + S3 + OPA access-control plugin |
| `data-runner` | `healthchecks/data_runner_ready.py` (imports the service's own client code): list Polaris namespaces + `head_bucket` on the uploads bucket | the ingest path's catalog and storage both work |
| `query-tool` | `healthchecks/query_tool_ready.py`: real `POST /query` → Trino, fails on any `error` (e.g. `no_catalog_configured`) | the governed read path os-ui uses actually returns rows |
| `cube` | `/readyz` | Cube's readiness, which tests its Trino data-source connection |
| `opensearch` | `_cluster/health?wait_for_status=yellow` returns `yellow`/`green` | the cluster can serve indexes |
| `openmetadata` | admin `/healthcheck` (Dropwizard DB + search checks) **and** `/api/v1/system/version` = 200, over bash `/dev/tcp` (the image has no curl/wget) | the exact API os-ui's build step calls is up |

The services' own `/health` endpoints (data-runner, query-tool) are static, so they are
not used as readiness signals here.

Warm-up tolerance lives in `start_period` (failures there don't count, and the first
success marks the service healthy). `retries: 3` means a backend that disappears later is
reported quickly. Negative check: stopping `trino` turns `query-tool` and `cube`
`unhealthy` within about a minute, while `data-runner` (Polaris + S3, not Trino) stays healthy:

```sh
./deploy/lakehouse-compose/lakehouse.sh stop trino
./deploy/lakehouse-compose/lakehouse.sh ps query-tool cube data-runner   # after ~60-90 s
./deploy/lakehouse-compose/lakehouse.sh start trino
```

## Validate

```powershell
# 1. Every service healthy / one-shots exited 0
.\deploy\lakehouse-compose\lakehouse.ps1 ps -a

# 2. End-to-end medallion run through the app's own MCP tools (as `admin`):
#    CSV -> Bronze -> Silver -> Gold, profile_dataset + query_data on the real tables.
#    Pipe straight into `docker compose`: PowerShell does not forward piped input
#    through the .ps1 wrapper to the native command inside it.
Get-Content deploy\lakehouse-compose\validate\e2e-medallion.js -Raw | docker compose -f compose.yaml -f deploy/lakehouse-compose/compose.lakehouse.yaml --env-file deploy/lakehouse-compose/.env exec -T os-ui node -
```

```sh
./deploy/lakehouse-compose/lakehouse.sh ps -a
./deploy/lakehouse-compose/lakehouse.sh exec -T os-ui node - < deploy/lakehouse-compose/validate/e2e-medallion.js
```

The script prints `PASS`/`FAIL` per step and exits non-zero on any failure. It creates
one personal dataset named `lakehouse_e2e_<timestamp>`. To inspect the physical tables directly:

```sh
./deploy/lakehouse-compose/lakehouse.sh exec trino trino --user admin --execute "SHOW TABLES FROM iceberg.personal_admin"
```

Manual check in the UI: **Data → New dataset → Upload a CSV**. The Bronze panel must say
*"Bronze is live"* (not *offline preview*). Then **Continue** builds Silver and Gold.

## Stop / start again

```sh
./deploy/lakehouse-compose/lakehouse.sh stop     # stop containers, keep everything
./deploy/lakehouse-compose/lakehouse.sh down     # remove containers + network, KEEP volumes
./deploy/lakehouse-compose/lakehouse.sh up -d
```

What survives `down` / restarts:
- Iceberg data files, in the MinIO volume.
- The Polaris catalog, in the Postgres volume.
- os-ui's dataset / file / agent registry. os-ui mirrors it to OpenSearch at its default
  `OPENSEARCH_URL`, kept in the `opensearch-data` volume.

So after a restart datasets are still listed with their Bronze, Silver and Gold layers, and
the tables stay queryable. Verified by restarting `os-ui`, `polaris` and `trino`, then
querying the Gold table.

## Cleanup (destroys this deployment's data)

```sh
./deploy/lakehouse-compose/lakehouse.sh down -v --remove-orphans
# optional: remove the locally built images of this project
docker image rm sovereign-lakehouse-os-ui sovereign-lakehouse-query-tool sovereign-lakehouse-data-runner sovereign-lakehouse-agent-runtime sovereign-lakehouse-mock-model
```

`down -v` only removes volumes named `sovereign-lakehouse_*`. The default stack's
volumes belong to a different project and are untouched.

## Limitations

- **Trino resource groups are not configured** (the chart's per-domain isolation).
  Memory is scaled down (`trino/config.properties`, `trino/jvm.config`: 2 GB heap,
  1 GB per query).
- **No Northpeak demo marts / seed Cube models.** The chart's `northpeak-marts-init`
  and the seed cubes (`northpeakcommerce`, `daily_revenue`, `mart_sales`) are not
  deployed. Cube serves only the models os-ui delivers for governed datasets
  (shared/certified with Gold built).
- **dbt, Superset, Dagster and OpenMetadata ingestion are not included.** Silver/Gold use
  the os-ui governed CTAS path, which is what the Data tab's Continue / Refine / Gold-join use.
  OpenMetadata runs without Airflow ingestion (as in the chart's local profile), so its
  catalog is not crawled from Trino. The **metric / dashboard** stages additionally verify a
  lineage edge via the OpenMetadata API with `OPENMETADATA_JWT`, and need Superset; those
  stages are outside this deployment's scope.
- **First start is slow:** OpenMetadata's migrate step plus a cold JVM can take 3–5 minutes.
- **The very first ingest after a fresh start can fall back to `offline-mock`.** os-ui decides
  live vs. mock with a 2.5 s `GET data-runner/health` (`dataRunnerReachable`). This was
  observed once, on the first call right after os-ui became healthy; all following calls
  were live. The likely cause is a slow first DNS lookup on Docker Desktop. The Bronze
  panel labels it *offline preview*. Re-ingest the file if you see that, and the
  validation script fails loudly on it.
- Polaris and catalog registration here only **create** a fresh catalog. If a stale
  `lakehouse` catalog without path-style storage is found, `polaris-catalog-init` fails
  with a message to clean up, rather than mutating it in place like the chart's upgrade path.
- `.env.example` is matched by the repo's `.gitignore` (`.env.*`). Use `git add -f` if you
  want to commit it.
