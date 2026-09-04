<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Architecture Assessment & Future Technical Directions

Principal-architect review of the Sovereign Agentic OS. Read against the live code
(os-ui 0.6.155, chart 0.2.x), the ADRs in `docs/decisions/`, `os-ui/ARCHITECTURE.md`,
`docs/deployment-editions-architecture.md`, and the `#146` analytics-monorepo plan.
Scope: is the architecture sound, is the stack rationalised, how does it scale, and
what are the right technical bets for the next 6–12 months. **Opinionated by design.**

External context cited inline (all 2026): durable-execution runtimes, the Open Semantic
Interchange, Postgres multi-tenancy patterns.

---

## TL;DR

The OS is **architecturally strong where it matters most**: a single governed data path
(UI, agents, and external MCP clients all funnel through the same OPA→execute→trace spine),
genuine defense-in-depth (OPA at the tool gate *and* Trino row/column masks at the read),
and a clean medallion + personal-lane model. The three-layer `core → infra → tab` code
structure is unusually disciplined for a system this broad.

The **single deepest fragility is persistence**: every tab store is an *authoritative
in-process `Map`* with a *best-effort* OpenSearch mirror (ADR 0003). This one decision
transitively forces `replicas: 1`, caps agents at in-request execution (300 s), and leaves
a real (if narrow) data-loss window on every pod roll. It is the correct *temporary* choice
that has quietly become load-bearing. **Making the registry durable-first is the highest-
leverage move on the board** — it unlocks horizontal scale, durable agents, and multi-tenancy
in one stroke.

The stack is mostly justified. Two components are over-weight for the value they add on the
hot path: **Cube** (already off the read path, slated to drop) and the **Langfuse tracing
sub-stack** (ClickHouse + Valkey + Postgres to trace one product). The 3-edition strategy is
the right *axis* (sovereignty × ops-cost), and the "curated-in, federated-detail" reframe is
the most important strategic idea in the repo.

---

## 1. Is the architecture sound and coherent?

### What is genuinely strong — credit where due

- **The governed single path (ADR 0005 — "MCP is the front door, never a back door").**
  Every tool's `call()` delegates to the *same* `lib` function the UI route calls, under the
  caller's session identity (never trusted from the request body). This is the load-bearing
  idea of the whole system and it is implemented, not aspirational: `lib/infra/governed.ts`
  (`authorize → execute → trace`) and `lib/infra/agent-governed.ts` are the one seam. A policy
  fix lands once and covers UI + external MCP + internal agents. Most "agent platforms" fork
  governance the moment an agent needs a shortcut; this one structurally cannot.

- **Defense-in-depth on data.** OPA gates *tool access* at the gateway (default-deny,
  **fail-closed** when OPA is unreachable — `governed.ts:authorize`), and then Trino's OPA
  plugin independently enforces **row filters by domain + column masks by sensitivity** on
  every physical read (`charts/.../policies/trino.rego`, `docs/components/query-tool.md`). Two
  independent enforcement points, different layers. A bug in one is backstopped by the other.
  This matches the 2026 consensus that RLS should be the backstop, not the front line
  (Nile/ClickHouse multi-tenancy guidance).

- **Medallion + personal-lane.** Bronze-stays-raw (read as `all_varchar`), Silver/Gold as
  Iceberg marts, and per-user `iceberg.personal_<uid>.*` schemas that use the *same* single
  Trino engine and the *same* OPA governance as shared marts. One engine, one dialect, one
  governance boundary (`query-tool.md` FAQ). This is clean and rare.

- **Single transform + single query engine.** dbt-trino is the *only* transform path and
  Trino is the *only* query engine; Cube, Superset, and the agent `query` tool all read the
  *same* Iceberg tables — so "the numbers can't drift" is an architectural property, not a
  hope.

- **The code architecture itself.** `core → infra → tab`, strict one-way imports, every tab
  the same shape (`index/schema/store/<feature>/README`), IO injected into pure domain logic
  so it unit-tests without a cluster. A contributor who learns one tab can work any tab. This
  is real, enforced discipline (`os-ui/ARCHITECTURE.md`).

### Where the seams are strained

**The persistence seam (the one that matters).** `lib/infra/os-mirror.ts` + ~25 tab stores
implement: *authoritative in-process `Map`; best-effort, fire-and-forget write-through to
OpenSearch; hydrate-from-mirror on boot.* Evidence: `data/store.ts:143`, `agents/store.ts:254`,
`knowledge/store.ts:141`, `governance/approvals.ts:140`, `agents/agent-memory.ts:67`, all
calling `osMirror(index)`. Consequences, all confirmed in code:

1. **Data-loss window on every roll.** Writes are `writeThrough(id, doc)` — no await, no
   confirmation. Between a mutation and the async flush landing in OpenSearch, a pod
   crash/roll loses that mutation. ADR 0003 names this honestly as the "residual gap": dropped
   writes are never replayed; the in-process Map stays authoritative until the next roll.
2. **`replicas: 1` is *forced*, not chosen** (`charts/.../templates/os-ui/os-ui.yaml:102`).
   Two pods = two divergent authoritative Maps + a hydrate/write race = split-brain. The whole
   product is pinned to one pod because of this store model.
3. **Agents can't be durable.** Runs execute *in-request* inside the Next.js route
   (`app/api/agents/systems/[id]/run/route.ts`, `maxDuration = 300`). There is no
   out-of-process worker or job queue. A `RunCheckpoint` + `recoverInterrupted()` salvage
   (`agents/store.ts:349`) provides *legible* recovery of interrupted runs — genuinely good —
   but it rides the same best-effort OpenSearch mirror and cannot exceed the 300 s request
   window. **The deployment-editions doc's "durable, Postgres-backed, resumable agents" is
   aspirational: there is no Postgres behind agent state today.**

The `data/store.ts` comment says the quiet part out loud: *"the MOCK store … it maps 1:1 to
the future Supabase `datasets` table."* The team knows this is transitional. It has simply
outgrown "temporary."

**Verdict:** the *control-plane / data-plane / governance / agent* separation is sound and
coherent. The strain is entirely in the **control-plane's own state durability** — the OS
governs a petabyte-capable lakehouse with rigor, while keeping its *own* registries in a
process `Map`. That asymmetry is the thing to fix.

### The right persistence architecture

Adopt the model the deployment-editions doc already sketches, but **make it the current-OS
default, not a Lite-only idea**: a **durable-first registry** with the `Map` demoted to a
read cache.

- **Authoritative store → Postgres** (CNPG is already in-cluster, wave-0, hosting 7+ backend
  DBs). One `registry` schema, one table per artifact kind (or a generic
  `artifacts(kind, id, domain, owner, tier, yaml, updated_at)` matching today's record shape
  — the stores already serialize to a single canonical YAML/JSON blob, so the migration is
  mechanical). Keep the `store.ts` public API identical; swap the `Map`+`osMirror` internals
  for Postgres reads/writes behind the existing seam.
- **OpenSearch stays** — but for what it is *good at*: full-text + kNN retrieval / discovery,
  not durability of record-of-truth.
- **`Map` becomes an optional per-request cache**, not the source of truth.
- **Result:** the write-loss window closes (synchronous, transactional write), `replicas: N`
  becomes possible, and durable agents get a real state backend for free.

Effort **L**, impact **very high**, risk **medium** (touching ~25 stores — but they share one
seam and one serialization shape, and the test suite is the safety net). This is the
foundational bet everything else in §5 leans on.

---

## 2. Stack rationalisation — is each dependency load-bearing?

Evidence base: `charts/.../values.yaml` enablement flags + `docs/components/*.md`.

### Clearly load-bearing — keep, complexity justified

| Component | Role | Why it stays |
|---|---|---|
| **Trino** | The single governed query engine | Federation + Iceberg R/W + OPA row/column on one dialect. The core of "numbers can't drift." |
| **Polaris** | Iceberg REST catalog | Metadata backbone for every Iceberg write (Trino, dbt, data-runner). |
| **OPA + trino.rego** | Default-deny authz + row/column | The governance invariant. Both hot-path gates. |
| **Postgres (CNPG)** | Infra DB (wave 0) | Already hosts Langfuse/LiteLLM/Dagster/Polaris/Superset DBs. *Should also host the registry (§1).* |
| **dbt-trino** | Sole transform path | Raw → staging → marts as Iceberg. |
| **LiteLLM** | Model + MCP gateway | Every agent/tool call routes through it; virtual keys + cost. Load-bearing and cheap. |
| **MinIO** | Object storage (Iceberg/blobs) | Local stand-in for STACKIT Object Storage; core. |
| **Forgejo** | Git substrate (apps + agent files + analytics monorepo) | Confirmed load-bearing this session; the Terraform-style plan→policy→apply pipeline (#146) depends on it. |
| **OpenSearch** | Hybrid retrieval / knowledge index | Load-bearing for retrieval — but *not* the right home for record-of-truth (§1). |

### Load-bearing but heavy — simplify or consolidate

- **Cube — the clearest cut.** Already **off the read path**; the editions doc explicitly says
  "**Drop Cube** — it caused this week's false-'refreshed' bugs" (and MEMORY corroborates the
  offline-mock fabrication class). Superset, the agent `query` tool, and Power BI can read
  governed Trino views + Cube's *metadata* export directly. **Recommendation: complete the
  drop; keep the metric-definition YAML as the semantic contract, serve it from git, and
  regard "Cube-the-service" as removed.** One caveat with a 2026 lens: the **Open Semantic
  Interchange** (OSI, Jan 2026 — a vendor-neutral YAML semantic standard backed by Snowflake,
  dbt Labs, Cube, Databricks, et al.) is where the industry is heading. Keep the *semantic
  layer as declarative YAML* (you already do); just don't keep a whole caching service on the
  read path to host it. Effort **M**, impact **high** (deletes a bug class + a service), risk
  **low** (already off the read path).

- **The Langfuse tracing sub-stack (Langfuse + ClickHouse + Valkey + a Postgres DB).** This is
  the single heaviest "supporting cast" in the stack: three backing engines to observe one
  product. It is load-bearing *as configured* (turning off ClickHouse or Valkey breaks/degrades
  Langfuse per their component docs), but the *weight* is questionable for most deployments.
  The editions doc's own answer is right: **for anything below the Full edition, trace to a
  Postgres `llm_traces` table** and treat the full Langfuse+ClickHouse rig as a Full-edition-only
  option. Recommendation: make tracing an **adapter** (`trace()` already is a single fn in
  `governed.ts`) with a Postgres-table implementation as the default and Langfuse as the
  opt-in. Effort **M**, impact **medium-high** (removes 2–3 services from the common case),
  risk **low**.

- **Dagster.** Real and wired (materializes dbt assets). But three CronJobs already do
  scheduling, and dbt runs as a post-install hook today. Dagster earns its place *only* once
  the #146 push-through-policy pipeline and scheduled DQ/metric refresh are the real operating
  mode. Until then it is heavier than the work it does. Keep, but **gate it behind the
  analytics-monorepo epic actually shipping** rather than running it half-used.

- **Superset.** Keep — but the native-ECharts-on-Cube/Trino dashboards decision (MEMORY:
  "drop Superset iframe, build native") is the right direction. Superset becomes the Tier-2
  "open in its own tab" power tool, not the embedded default.

### Dormant / optional / correctly gated — no action

- **Science L4 (Featureform, KServe, MLflow, ml-agent)** — all `enabled: false` behind the
  `ml.enabled` master switch. Correctly opt-in; the KServe runtime-autoselect fix (MEMORY,
  0.6.109) shows it's maintained, not rotting. Leave off by default.
- **Haystack** — wired but secondary (agents do their own kNN over OpenSearch). Candidate for
  removal if agent-native retrieval + the librarian (§5) fully cover it. Low priority.
- **Docling / OpenMetadata** — `enabled: true` product default, off locally for RAM. Fine.
  OpenMetadata's catalog is informational (not on the read path); keep ingestion gated.

**Net:** the sovereign core (Trino/Polaris/OPA/dbt/MinIO/Forgejo/LiteLLM/Postgres) is tight
and justified. The rationalisation targets are **Cube (remove), the Langfuse tracing weight
(make it an adapter), and Dagster (earn-its-keep gate)** — none of which touch sovereignty.

---

## 3. Scalability & multi-tenancy

**Today:** single-replica, single-tenant-shaped. The constraints are all downstream of §1's
`Map`-authoritative store.

- **Horizontal scale of os-ui** is blocked purely by the in-process store. Fix §1 (Postgres-
  authoritative registry) → os-ui becomes stateless → `replicas: N` behind the existing
  ingress. This is the single highest-leverage scaling change.
- **Long-running agents** need to move *out of the request*. Two options, and the 2026
  evidence is clear (Spheron, Temporal, Reactify surveys): a **durable-execution runtime** is
  now table-stakes for production agents — "the RFP question is no longer *how does your agent
  handle a 90-second timeout*; it's *which durable runtime and what is the replay story*."
  - **Full/sovereign edition:** an in-cluster durable worker (Temporal or Restate, self-hosted,
    EU-friendly) that journals each agent step; os-ui `POST`s and returns a `run_id`, the
    worker drives steps and writes progress to the (now-durable) registry, UI streams. The
    existing `RunCheckpoint`/`recoverInterrupted` design maps almost 1:1 onto a durable-
    execution history — you've already built the *shape*, you just need the *engine*.
  - **Lite edition:** Inngest / Trigger.dev / DBOS (Postgres-native) as the editions doc says.
- **Multi-tenancy at scale.** The editions doc's tiered model is exactly right and matches
  2026 best practice (DoHost, Nile, ClickHouse guidance): **shared schema/project + RLS as the
  default (cheap, scales to many small domains), dedicated project for large/sensitive/
  residency-pinned domains.** The domain-isolation model (MEMORY: My/Domain/Company; Marketplace
  the only cross-domain surface) is already the logical version of this; the physical
  connection-registry (`domain_id → {project, schema, tier}`) makes it real. Recommendation:
  keep API-layer domain filtering as the primary gate and RLS as the backstop (defense in
  depth — same posture you already use for data).
- **The lakehouse tier already scales** (Trino is distributed, Iceberg is petabyte-capable).
  The scaling problem is *not* the data plane — it's the control plane's own state. Fix that
  and the scale ceiling moves from the Next.js process to Trino, where it belongs.

---

## 4. The 3-edition strategy — is it the right axis?

**Yes.** The axis is *sovereignty × operational cost*, which is the correct one for this
product's market (EU/on-prem buyers who want agentic analytics without a US SaaS + external-
inference dependency). Cloud Lite (Vercel+Supabase) / Sovereign Lite (1–2 VMs) / Sovereign
Full (k8s) is a clean ladder, and the **"each backend is an adapter interface, upgrading swaps
a dependency not a rewrite"** design rule is the thing that makes it credible rather than three
codebases.

Two sharpening points:

1. **The adapter seams must be real before the editions are.** Today the strongest seam is
   `governed.ts`/`agent-governed.ts` (tool execution) and the store contract. The identity
   seam (`currentUser`/`requireUser`, README notes a future Ory swap) and the tracing seam are
   the next to formalise. Make **data-store, identity, tracing, agent-exec, vector, LLM** each
   a named interface with ≥2 implementations *proven in CI*, or the editions are a slide, not a
   product. This is the concrete work behind the strategy.
2. **The strategic reframe is the real prize.** §11 of the editions doc — *"the OS becomes the
   governance + curation-orchestration + agent + app layer over data that mostly stays where it
   already lives, not the owner of the raw pipeline"* — is the most important sentence in the
   repo. "Curated-in, federated-detail" (replicate only trustworthy Gold; reach raw/PII point-
   to-point on drill-down, with honest degradation) is a *better default posture even for the
   Full edition*, and it dramatically shrinks what any edition must store. **Bet on this.**

---

## 5. Prioritised technical bets — next 6–12 months

Ordered by leverage. Each: rationale · effort · impact · risk.

### Bet 1 — Durable-first registry (Postgres-authoritative, `Map` → cache)
The keystone. Closes the write-loss window, unblocks `replicas: N`, and gives durable agents a
real backend. Everything else compounds off it. Reuse CNPG; keep the store public APIs; swap
internals behind the one seam. · **L** · **very high** · **medium** (25 stores, one shape, tests
as net).

### Bet 2 — Durable agent execution out of the request
Move agent runs to an out-of-process durable runtime (Temporal/Restate in Full; Inngest/DBOS in
Lite). Your `RunCheckpoint`/`recoverInterrupted` already models the history — adopt an engine
that provides it natively instead of hand-rolling on a best-effort mirror. 2026 consensus:
non-negotiable for production agents (Spheron/Temporal/Reactify). Depends on Bet 1 for state.
· **M–L** · **high** · **medium**.

### Bet 3 — Complete the Cube drop; keep semantics as declarative YAML (OSI-aware)
Delete a whole caching service *and* a confirmed bug class. Serve metric definitions from git;
Superset/query-tool/Power BI read governed Trino views + metadata. Track the Open Semantic
Interchange (Jan 2026) so the YAML stays portable. · **M** · **high** · **low**.

### Bet 4 — Promote = governed VIEW + grant, not a physical CTAS copy
The editions doc calls this "the highest-leverage current-OS simplification," and the code
already has the flag (`promoteAsView`, default OFF — git log `7119b186`). Physical promotion is
the entire zombie / name-collision / re-materialize bug class (MEMORY: dataset-lifecycle
cascade). Trino views + OPA row filters make promotion *policy, not copy*. Flip it on, delete
the bug class. · **M** · **high** · **medium** (governance-critical — validate row-filter
inheritance carefully).

### Bet 5 — Formalise the edition adapter seams (data / identity / tracing / agent-exec / vector / LLM)
Turn the 3-edition strategy from design into product: each backend a named interface with ≥2
CI-proven implementations. Start with the two heaviest wins — **tracing adapter** (Postgres-table
default, Langfuse opt-in; strips ClickHouse+Valkey from the common case) and **identity seam**
(Ory ↔ Supabase Auth ↔ Zitadel). · **M** per seam · **high** (unlocks Lite) · **low–medium**.

### Bet 6 — Land "curated-in, federated-detail" as the default posture
Make replicate-Gold-in + federate-detail-on-drill-down (with honest "source unavailable —
curated as of <ts>" degradation) the default, not an option. Shrinks storage/materialisation
across all editions and realises the strategic reframe. The connected/live + sync modes already
exist; change the default and the drill-down adapter. · **M–L** · **high** (strategic) · **medium**.

### Bet 7 — Ship the analytics-as-code push-through-policy pipeline (#146)
The registry-authoritative, git-as-proposal, Terraform-style **plan → OPA/Conftest → apply →
Cube/OM regen** loop. Much is already built (git mirror, CI artifacts, git-serving paths behind
flags); the gap is the *human-push-through-policy* half and turning the built-but-off git-serving
paths on. This is what makes Dagster earn its keep and gives sovereign customers a real GitOps
analytics story. Resolve the git-identity decision (shared service account → per-user tokens)
first. · **L** · **medium-high** · **medium**.

### Bet 8 — Context curation: promote the Librarian from "curate-when-crowded" to first-class
**Complement to the separate context-curation research — do not duplicate it.** You already have
the right foundation: `lib/infra/context/librarian.ts` + `context-assembler.ts` — a *governed*,
budget-aware curator that scores DLS/OPA-*entitled* candidates by relevance, keeps high-relevance
material whole, compacts the middle, degrades gracefully with no embedder, and **never widens
access**. This is precisely "beyond naive RAG toward librarian/agentic assembly," and it's
architecturally correct because curation runs *inside* the governance boundary, not around it.
The bet: make it *always-on* (not just when crowded), wire the real sovereign-embed adapter
(Phase 2 hook already exists), and let the design agent's research drive the *assembly strategy*
on top of this governed selection substrate. · **M** · **medium-high** · **low**.

### Lower-priority / watch
- **Connectors** (`docs/CONNECTOR-STANDARD.md` is already a strong normative gate — runs-as-user,
  write-only secrets, honest failure, egress-allowlisted). Keep expanding via the registry
  pattern; the standard is good, no architectural change needed.
- **Observability** beyond LLM traces: once os-ui is multi-replica, add basic
  OpenTelemetry/Prometheus for the app tier (currently observability = Langfuse LLM traces only).

---

## 6. One-paragraph verdict

This is a genuinely well-architected system whose *governance* is more mature than its *own
state durability*. The governed-single-path (ADR 0005), the OPA+Trino defense-in-depth, and the
medallion/personal-lane model are the kind of load-bearing decisions most platforms never get
right, and they're real in the code. The single thing holding the system to one replica, one
tenant-shape, and in-request agents is the `Map`-authoritative registry (ADR 0003) — a correct
temporary choice that has become the ceiling. Make the registry durable-first (Bet 1), move
agents to a durable runtime (Bet 2), and finish the Cube-drop / promote-as-view / tracing-adapter
simplifications the team has *already scoped and half-built*, and the OS graduates from an
impressively-governed single-node product to a horizontally-scalable, multi-tenant, sovereign
platform without a rewrite — because the seams to do it are already in the code.

---

### Sources (external, 2026)
- Durable agent runtimes: [Spheron](https://www.spheron.network/blog/ai-agent-workflow-orchestration-temporal-inngest-restate-gpu-cloud/) · [Temporal LangGraph plugin](https://temporal.io/blog/temporal-langgraph-plugin-durable-execution) · [Reactify — Temporal/Inngest/DBOS/Restate](https://www.reactify-solutions.com/articles/durable-ai-agents-2026)
- Semantic layer / OSI: [Cube — best semantic layer 2026](https://cube.dev/articles/best-semantic-layer-for-ai-and-bi-2026) · [Atlan](https://atlan.com/know/best-semantic-layer-tools/)
- Multi-tenancy: [Nile — Postgres RLS multi-tenant](https://www.thenile.dev/blog/multi-tenant-rls) · [ClickHouse — multi-tenant SaaS on Postgres](https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture) · [DoHost — PG isolation patterns](https://dohost.us/index.php/2026/06/12/designing-for-multi-tenancy-scalable-data-isolation-patterns-in-postgresql/)
