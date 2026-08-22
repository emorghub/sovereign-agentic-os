# Sovereign Agentic OS — Deployment Editions & Simplified Reference Architecture

Status: design exploration (not shipped). Purpose: size a radically simpler deployment of
the OS and show how it maps onto the *existing* domain-isolation + medallion + Marketplace
model — plus what to keep sovereign.

---

## 1. Three editions (one codebase, pluggable backends)

| | **Cloud Lite** | **Sovereign Lite** (sweet spot) | **Sovereign Full** (today) |
|---|---|---|---|
| App host | Vercel | Coolify/Dokploy on a VM, or STACKIT/Scaleway/OVH | Kubernetes + Helm |
| Data plane | Supabase Cloud (Postgres) | Self-hosted Supabase *or* Postgres+pgvector+MinIO | Trino + Iceberg + object store |
| Analytics tier | Postgres MV + DuckDB | DuckDB on Parquet | Trino (columnar, distributed) |
| Identity | Supabase Auth | Supabase Auth / Zitadel (EU) | Ory |
| Governance | Postgres RLS | Postgres RLS | OPA (+ Trino OPA) |
| Vector/knowledge | pgvector | pgvector | OpenSearch |
| LLM | Anthropic/OpenAI API | self-hosted LiteLLM → Mistral / Aleph Alpha / vLLM | LiteLLM → self-hosted models |
| Tracing | Langfuse Cloud or Postgres table | Langfuse (self-host) or Postgres table | Langfuse + ClickHouse |
| Agents | Inngest/Trigger.dev + Postgres state | same, or a small worker | in-cluster LangGraph |
| Apps | declarative AppSpec (no build infra) | declarative AppSpec | declarative + optional coded images |
| Sovereignty | ✗ (US SaaS + external AI) | ✓ (EU/on-prem, self-hosted inference) | ✓✓ |
| Ops | ~none | ~1–2 VMs | cluster |
| Scale ceiling | curated GBs/domain | curated GBs–TBs/domain | petabyte lakehouse |

**Design rule:** each backend is an *adapter interface* (data, identity, governance, vector,
LLM, tracing, agent-exec, connectors). "Upgrading" an edition swaps a dependency, not a rewrite.

---

## 2. Reference architecture (Lite: per-domain data plane)

```
                         ┌─────────────────────────────────────────┐
                         │  CONTROL PLANE  (1 shared Supabase)      │
   Vercel / Coolify      │  • identity + auth (issues signed JWT)   │
   ┌───────────────┐     │  • domain registry + connection registry │
   │   os-ui       │◄────┤  • MARKETPLACE catalog + snapshots       │
   │  (Next.js)    │     │  • platform-admin, billing, x-domain audit│
   └──────┬────────┘     └─────────────────────────────────────────┘
          │ resolve active domain → {project, schema} from registry
          │
   ┌──────┴───────────────── per-domain DATA PLANE ─────────────────────────┐
   │  Domain A (own Supabase)        Domains C+D (shared Supabase project)   │
   │  • curated GOLD marts           •  schema_c.* / schema_d.* + RLS        │
   │  • app RECORDS (writes)         •  same tables, isolated by schema+RLS  │
   │  • knowledge (pgvector)                                                  │
   │  • metric/dashboard/app/agent DEFINITIONS                               │
   │  • domain audit                                                          │
   └────────────────────────────────────────────────────────────────────────┘
          │ point-to-point (on drill-down only)
   ┌──────┴─────────────────────────────────────────────────────────────────┐
   │  DETAIL at source: Databricks / Snowflake / BigQuery / operational DBs   │
   │  reached via per-connection SQL adapters (governed, cached, timeout'd)   │
   └──────────────────────────────────────────────────────────────────────────┘
```

**The posture:** *curated in, detail federated.* Only the trustworthy, documented, curated
GOLD layer is replicated into the domain's Supabase (small, fast, always-available, governed).
Raw/PII/transaction-level data stays at the source and is reached point-to-point on demand.

---

## 3. Domain co-location (the connection registry hides it)

`domain_id → { supabase_url, schema, key_ref, tier }` in the control plane.

- **Shared tier:** many small/light domains in ONE big Supabase project, isolated by
  `schema-per-domain` + RLS. Cheapest; the biggest project happily hosts several small domains.
- **Dedicated tier:** a large / sensitive / residency-pinned domain gets its **own** project.
- os-ui asks the registry, gets a client + schema, and doesn't care which tier it is.
- **Cost control:** default new domains to shared; promote to dedicated on growth/residency.
  A domain = usually a paying BU/customer, so dedicated cost aligns with value.

---

## 4. Marketplace (the only cross-domain surface)

Lives on the **control plane**, not a separate instance:
- **Catalog:** listings, publisher, ratings, and a **snapshot** of the artifact (definition for
  apps/metrics/knowledge; a curated-gold Parquet snapshot for datasets). Small.
- **Publish** → snapshot into control-plane marketplace store.
- **Adopt** → **copy** the snapshot INTO the adopting domain's Supabase (certified-copy).
- No domain ever reads another domain's DB. Only flow: `publish → control-plane → adopt-copy`.
  This is today's isolation model made physical.

---

## 5. Identity → per-domain RLS trust

Supabase Auth is per-project, so identity is centralized:
1. Control plane authenticates the user and **issues a signed JWT** with claims
   `{ sub, role, domains[], active_domain }`.
2. Each domain DB trusts that JWT (Supabase external/asymmetric-JWT support).
3. Domain RLS policies read the claims: row/tier visibility from `role` + `active_domain`;
   column masking via governed views. One-time setup, standard pattern.

---

## 6. Curated-sync vs point-to-point detail

- **Curated sync:** transforms run **at the source** (dbt-on-Databricks/Snowflake or the
  customer's pipeline); only GOLD lands in the domain Supabase, on a schedule
  (Airbyte/Fivetran/Estuary, or pg_cron + worker). Carries an "as of \<ts\>" freshness stamp.
- **Point-to-point detail:** a drill-down fires a per-connection SQL adapter at the source
  (Databricks SQL / Snowflake / BigQuery drivers in an edge/worker fn). Governed at the
  adapter; timeouts + cache + **honest degradation** ("source unavailable — showing curated
  summary as of \<ts\>"). Avoid curated×detail joins; enrich client-side when unavoidable.
- **Federation escape hatch:** for true live cross-warehouse joins with pushdown, point the
  adapter at **Starburst Galaxy** (managed Trino) — reach federation without operating it.

---

## 7. Long-running agents (durable, not in-request)

- Run agents on **Inngest** or **Trigger.dev**: each agent step is a durable step (retries, no
  wall-clock limit), surviving function recycling.
- Persist run state (`agent_runs`: nodes, messages, step, status) in the domain DB → resumable.
- Flow: POST → return `run_id` → durable worker processes steps, writes progress → UI streams
  via **Supabase Realtime**. Cleaner than long-lived in-cluster processes.
- Single-agent turns just stream within the function limit — no worker needed.

---

## 8. Provision-domain lifecycle

`create domain` job: (shared tier) create schema + run migrations; (dedicated tier) create a
Supabase project via the Management API + migrate + register in the connection registry +
seed default folders/roles. `offboard`: export + drop schema/project + deregister. Far lighter
than k8s, but real lifecycle — build it once.

---

## 9. What also simplifies the CURRENT (Full) OS

Independent of Lite, these are logical simplifications of today's stack:
- **Drop Cube** — already off the read path; it caused this week's false-"refreshed" bugs.
- **Promote = governed VIEW + grant, not a physical CTAS copy.** The entire
  zombie / name-collision / re-materialize class exists only because promotion physically
  copies gold into a domain schema. Trino supports governed views + OPA row filters → "promote
  = policy, not copy" would delete that bug class. *Highest-leverage current-OS simplification.*
- **Curated-in + federated-detail as the default** posture (less to store/materialize) — the
  connected/live + sync/replicate modes already exist; make them the default.
- **Durable agent state** (Postgres-backed, resumable) improves current agent robustness too.

Lite-only (not current-OS simplifications): per-domain physical DBs, central-JWT→RLS, dbt-at-source.

---

## 10. Sovereign without Vercel/Supabase

Same architecture, self-hostable parts (the **Sovereign Lite** column above):
- **App host:** Coolify/Dokploy (open-source Vercel-like PaaS on your own VM) or STACKIT /
  Scaleway Serverless Containers / OVH / Clever Cloud (EU).
- **Data plane:** self-hosted **Supabase** (OSS: Postgres + Auth + Storage + pgvector +
  Realtime + Edge Functions), *or* vanilla Postgres+pgvector + MinIO/garage + **Zitadel** (EU IdP).
- **Analytics:** **DuckDB** over Parquet in object storage (columnar speed, embedded, no cluster).
- **LLM:** self-hosted **LiteLLM** gateway → **Mistral / Aleph Alpha** (EU) or **vLLM/Ollama**
  on a GPU box — restores sovereign inference the Cloud edition gives up.
- **Tracing:** self-hosted Langfuse, or a Postgres `llm_traces` table.
- Result: identical design to the Vercel+Supabase edition, running on ~1–2 sovereign/EU VMs.

---

## 11. Honest limits

- Curated-only + single-primary Postgres per domain: GBs–low-TBs per domain, not a lakehouse.
- Live governed cross-warehouse federation with pushdown is the one thing Lite can't do
  natively → replicate-in (default) or managed Starburst (escape hatch).
- "Cloud Lite" trades sovereignty for zero-ops (US SaaS + external inference); "Sovereign Lite"
  buys it back at the cost of running ~1–2 VMs.
- The strategic reframe: the OS becomes the **governance + curation-orchestration + agent + app**
  layer over data that mostly stays where it already lives — not the owner of the raw pipeline.
