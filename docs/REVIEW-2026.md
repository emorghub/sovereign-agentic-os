<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Sovereign Agentic OS — Consolidated Review 2026

**Reviews synthesized:** Security · Maintainability · Readability/Docs · Architecture/Future · Design (Magic + Simplicity)
**Source documents:** [`code-review-security.md`](code-review-security.md) · [`code-review-maintainability.md`](code-review-maintainability.md) · [`code-review-readability-docs.md`](code-review-readability-docs.md) · [`code-review-architecture-future.md`](code-review-architecture-future.md) · [`design-review-2026-magic-simplicity.md`](design-review-2026-magic-simplicity.md)
**Code base:** `os-ui 0.6.155`, chart `0.2.0-alpha.11` · **Date:** 2026-08-22

---

## Executive Summary

The OS is **architecturally ahead of its surface and more mature in governance than in its own durability.** The verdict across all five reviews is consistent: the right decisions were made at the load-bearing points — a single governed path for UI + agents + MCP, OPA+Trino defense-in-depth, the medallion/personal-lane model, a clean `core → infra → tab` code structure, ~5,755 co-located tests, and an exemplary CHANGELOG. The weaknesses are structural and concentrated.

**The 5–8 things that matter most across all five reviews:**

1. **Durability is the ceiling.** Every tab store is an authoritative in-process `Map` with a best-effort OpenSearch mirror. This one design decision forces `replicas: 1`, caps agent runs at 300 s in-request, and creates a real (if narrow) write-loss window on every pod roll. Platform-admin stores (`settings`, `security`, `tenant`, `plugins`) are not even mirrored — they silently revert to defaults on every redeploy. This is the single highest-leverage fix on the board. *(Maintainability F1/F2; Architecture Bet 1)*

2. **Security H0 — SQL injection in the metric builder.** `form.column` and `form.filter.column` are only `.trim()`'d before being interpolated into executed Trino SQL. All other identifier builders in the codebase use `qcol()` / IDENT-validation — the metrics path is the one that skipped it. Contained by the read running as the caller's own governed principal (High, not Critical). *(Security H0)*

3. **Security H1 — grant injection at promotion.** `req.grants` (requester-supplied) is persisted verbatim at approval with no check against the approver's authority — enabling cross-domain / named-user grant injection on a routine Builder rubber-stamp. *(Security H1)*

4. **Security H2 — static runtime bearer ships to prod.** The `agent-runtime.yaml` renders the well-known `agent-runtime-local-dev-token` on the live deploy (no `randAlphaNum` fallback, no boot guard coverage) combined with `serviceBearer.enabled:false` and no default-deny Ingress NetworkPolicy on `query-tool`. Together these make network reach == write-path identity on the data plane. *(Security H2)*

5. **The OS Guide was 124 build-versions stale** (`os-ui 0.6.31` hardcoded; code at `0.6.156`). The Agents tab, Software tab, Data auto-advance, and Autonomy toggle were all materially wrong. **Fixed in this session** (guide updated, PDF regenerated). *(Readability H1 — resolved)*

6. **Software Build P0 — Forgejo/CI path is the only route for "coded" apps; the declarative path is the product.** The declarative AppSpec model is fully live and correct; the historic coded path is off by default and platform-admin-gated. The MEMORY note flagged "do NOT enable softwareBuild until fixed" — the guide now correctly describes the declarative path as the default. *(Maintainability context; Architecture)*

7. **UX: the surfaces are over-buttoned and the assistant mostly chats rather than does.** A dataset header can show up to 10 competing controls; three different promotion code-paths exist; the per-stage AI assistant is wired in Agents/Software but absent from Data/Metrics/Dashboards/Connections/Files. The design review identifies the inversion: make the calm conversation the front page and the full staged builder one "Expert Mode" tap away. *(Design §1–2b)*

8. **The in-memory store asymmetry is an architectural tell:** the OS governs a petabyte-capable lakehouse with rigor while keeping its own registries in a process Map. The fix path is clear and mechanical (CNPG Postgres is already in-cluster; stores already serialize to a single canonical blob). *(Architecture Bet 1)*

---

## Prioritized Backlog

| ID | Area | Title | Severity / Impact | Effort | One-line fix | Status |
|---|---|---|---|---|---|---|
| **SEC-H0** | Security | SQL injection via unvalidated metric column | HIGH | S | IDENT-validate `form.column`/`form.filter.column` against the Gold schema server-side; reuse `qcol()` in `measureFromForm`/`defineMeasure` (`lib/metrics/model.ts:123,202`) | **Fix tonight** |
| **SEC-H1** | Security | Grant injection at promotion approval | HIGH | S | Validate `req.grants` against approver's authority before `d.grants = req.grants` (`lib/data/store.ts:1560,1408,1679`) | **Fix tonight** |
| **SEC-H2** | Security | Static runtime bearer + open intra-namespace network (live deploy) | HIGH (infra) | M | (a) Add `randAlphaNum 48` to `agent-runtime.yaml`; (b) set `serviceBearer.enabled:true` in prod values; (c) add default-deny Ingress NetworkPolicy on query-tool/data-runner | **Needs decision — infra auth-posture change** |
| **SEC-H3** | Security | Embedded platform tools run same-origin (ToolWindow XSS) | HIGH (defense-in-depth) | M | Serve each tool from its own subdomain; drop `allow-same-origin` from `ToolWindow.tsx:151` | **Needs decision — subdomain setup** |
| **MAIN-F1** | Maintainability | Platform-admin settings + security/tenant/plugins fully volatile | HIGH | S | Give `settings.ts`, `security.ts`, `tenant.ts`, `plugins.ts` the same `osMirror` write-through + boot hydration as the other stores | **Fix tonight** |
| **MAIN-F2** | Maintainability / Architecture | In-memory-authoritative store → one-replica ceiling + write-loss | HIGH | L (fix) / S (guardrail) | Short-term: assert `replicas: 1` as a hard invariant. Long-term: Postgres-authoritative registry, `Map` as cache (CNPG already in-cluster) | **Needs decision — architectural bet** |
| **DOCS-H1** | Readability | OS Guide + PDF 124 versions stale (`os-ui 0.6.31`) | HIGH | S | Update version string + stale sections; regen PDF via `scripts/build-docs.sh` | **Resolved this session** |
| **ARCH-B1** | Architecture | Durable-first registry (Postgres-authoritative) | HIGH (long-term) | L | Swap `Map`+`osMirror` internals for Postgres reads/writes; keep store public APIs identical; enables `replicas: N` + durable agents | **Needs decision — strategic bet** |
| **ARCH-B3** | Architecture | Complete the Cube drop | HIGH | M | Delete Cube service from read path; serve metric YAML from git; Power BI/Superset/query-tool read governed Trino views | **Needs decision — infra change** |
| **ARCH-B4** | Architecture | Promote-as-view (delete the zombie/collision bug class) | HIGH | M | Flip `promoteAsView` flag ON; promotion = governed Trino VIEW + grant, not physical CTAS copy (`promoteAsView` flag ships OFF, code verified live) | **Needs decision — governance-critical validation** |
| **DES-Q1** | Design | Control budget — collapse lifecycle controls into `⋯ Manage` menu | HIGH | S | Fold Archive/Delete/Versions/Demote into one `⋯ Manage` inside `LifecycleActions`; header shows Back · name · one primary · ⋯ | **Needs decision — UX bet** |
| **DES-Q3** | Design | Data header has 10 competing controls (Certify + Request = same act) | HIGH | S | Role-switch Certify/Request-cert to one button; move Demote/Archive/Versions behind `⋯ Manage` (`DataBuilder.tsx` header ~L1030–1154) | **Needs decision — UX bet** |
| **DES-Q4** | Design | Agents double toggle (Simple/Developer AND View/Edit stacked) | HIGH | S | Collapse to one `View · Edit · Advanced` control (`SystemView.tsx:L393–438`) | **Needs decision — UX bet** |
| **SEC-M1** | Security | Agent `os.records.*` writes bypass write-approval hold | MEDIUM | S | Route agent-initiated record writes through `holdDecision` envelope, or document as explicit exception with a test (`app-records.ts:82`) | Backlog |
| **SEC-M2** | Security | Promotion release keyed by schema alone (race + over-broad exemption) | MEDIUM | S | Key releases by `<schema>\|<fqn>`; have rego match table fqn (`live-clients.ts:280`, `trino.rego:141`) | Backlog |
| **SEC-M3** | Security | Terminal/Workbench broker secret not profile-gated | MEDIUM | S | Gate `brokerSecret` on `local` profile or add Helm `required`/`fail` (`terminal.yaml:113`, `workbench.yaml:127`) | Backlog |
| **SEC-M4** | Security | Compiler-missed internal iceberg tables world-readable | MEDIUM (defense-in-depth) | S | Extend fail-closed floor to `iceberg.*` — any non-personal table with no governance entry should get `false` row filter (`trino.rego:33`) | Backlog |
| **SEC-M5** | Security | Runtime apps run same-origin (design tradeoff to document) | MEDIUM (by design) | M | Document as explicit decision; harden by serving from a distinct origin or minting a scoped app token (`app-runtime.ts:139`) | Needs decision |
| **SEC-M6** | Security | Deactivated user's MCP token keeps resolving | MEDIUM | S | Add `u.disabled` check to `resolveMcpUser` (`lib/mcp/token.ts:105–111`) | Backlog |
| **SEC-M7** | Security | web-fetch no DNS-rebind guard | MEDIUM | S | Reuse `secrets.ts` IP denylist in `web-fetch/app.py:39–44` | Backlog |
| **MAIN-F3** | Maintainability | Cross-tab internal-import invariant unenforced (~49 violations) | MEDIUM | M | Add lint tripwire test (same style as route-guard test); grep `lib/<tab>/*` for `from '../<othertab>/` where target isn't `index.ts` | Backlog |
| **MAIN-F4** | Maintainability | 2,000+ line god-components | MEDIUM | M | Decompose `DataBuilder.tsx` (99 hooks), `SoftwareBuilder.tsx` (2,543 lines), `apps.ts` (71 exports) by stage/concern | Backlog |
| **MAIN-F5** | Maintainability | 55 one-off deploy scripts + fragile `--reuse-values` | MEDIUM | S–M | Collapse to one parameterised `deploy.sh <version>` with explicit values file + `rollout restart` | Backlog |
| **DES-M1** | Design | Three promotion code-paths (promoteBlock / PromoteButton / post('promote')) | MEDIUM | M | Unify on single `<PromoteButton>`/`<DemoteButton>`; retire `promoteBlock` and bare `post('promote')` in Agents | Needs decision |
| **DES-M3** | Design | No proactive assistant on Data/Metrics/Dashboards/Connections/Files | MEDIUM | M | Mount `StageAssistantChat` with state-derived `autoFirePrompt` + Apply cards on the five assistant-less tabs | Needs decision |
| **DES-M4** | Design | `orchestrate` intent + Plan→Preview→Confirm flow | MEDIUM | M | Add fourth `classifyAsk` mode; expose `proposePlan` preview UI reusing Big Bets roadmap visual | Needs decision |
| **DES-M6** | Design | Assistant-first pilot (Metrics + Dashboards) | MEDIUM | M | Mount `StageAssistantChat` as default full-width body; relabel `BuilderModeToggle` → `Assistant · Expert`; stage machine under Expert only | Needs decision |
| **DOCS-H2** | Readability | Dual version scheme undocumented (onboarding trap) | MEDIUM | S | Add "Versioning" note to `CHANGELOG.md`/`README.md` explaining chart version vs os-ui build stream | Backlog |
| **DOCS-H3** | Readability | No persistence/os-mirror map for new engineers | MEDIUM | S | Add "Data durability & mirrors" section to `ARCHITECTURE.md` (para + pointer to ADR-0003) | Backlog |
| **ARCH-B2** | Architecture | Durable agent execution out of the request | MEDIUM | M–L | Move agent runs to out-of-process durable runtime (Temporal/Restate in Full; Inngest/DBOS in Lite); `RunCheckpoint`/`recoverInterrupted` already models the history | Needs decision |
| **ARCH-B5** | Architecture | Formalise edition adapter seams | MEDIUM | M per seam | Named interfaces with ≥2 CI-proven implementations for data-store, identity, tracing, agent-exec, vector, LLM | Needs decision |
| **DES-B1** | Design | "What do you want to build today?" start screen | LOW–MEDIUM | L | Full flow: intent → plan → Big Bet via `approvePlan`; grounded agent steps via `proposeTeam`; reuses `AskAssistant` + `bigbets/planner.ts` | Needs decision |
| **DES-B2** | Design | Hybrid retrieval front-end (BM25 + kNN + graph → RRF → rerank) | MEDIUM | L | New stages before existing `curateContext`; feeds `librarian.ts` unchanged; Contextual-Retrieval corpus prep at index time | Needs decision |
| **DES-B4** | Design | Governed agent memory as grantable context type | MEDIUM | L | Add episodic/semantic/procedural memory to `ChooseContextShell`; curated by librarian; DLS-scoped; `agent-memory.ts` seed exists | Needs decision |
| **DOCS-M3** | Readability | `deployment-editions-architecture.md` reads as current | LOW | S | Promote "Status: design exploration" to prominent callout at top of doc | Backlog |
| **DOCS-M5** | Readability | README Invariants sections missing (dashboards/knowledge/agents tabs) | LOW | S | Add Invariants + seams section to three tab READMEs to match connections template | Backlog |
| **ARCH-B6** | Architecture | "Curated-in, federated-detail" as default posture | LOW | M–L | Make replicate-Gold-in + federate-detail-on-drill-down the default; change default of connected/live mode; add honest degradation | Needs decision |

---

## What Is Being Fixed Tonight vs Needs Your Decision

### Fixed tonight (in-flight or landing imminently)

| ID | Description |
|---|---|
| **DOCS-H1** | OS Guide + PDF updated to `os-ui 0.6.156`; Agents six-stage builder, Software declarative model, Data auto-advance, Autonomy toggle corrected. PDF regenerated via `scripts/build-docs.sh`. |
| **SEC-H0** | SQL-ident injection in metric column builder — fix in `lib/metrics/model.ts` using `qcol()` pattern |
| **SEC-H1** | Grant-target injection at promotion — validate `req.grants` against approver authority in `lib/data/store.ts` |
| **MAIN-F1** | Platform-admin settings/security/tenant/plugins persistence — add `osMirror` write-through to the four volatile stores |

### Needs your decision (design bets or significant posture changes)

**Security / infra posture:**
- **SEC-H2** — Enabling `serviceBearer` and adding a default-deny Ingress NetworkPolicy on `query-tool`/`data-runner` changes the live cluster's authentication posture. High priority but requires a deliberate ops window.
- **SEC-H3 / SEC-M5** — Serving embedded tools and runtime apps from a separate origin requires subdomain provisioning and SSO plumbing.

**Architectural bets (high impact, high effort):**
- **ARCH-B1 / MAIN-F2** — Durable-first Postgres registry. The single highest-leverage structural change; unlocks horizontal scale and durable agents. Effort L, but the seam is clean.
- **ARCH-B2** — Moving agent runs out of the request to a durable runtime. Depends on ARCH-B1.
- **ARCH-B3** — Completing the Cube drop. Already off the read path; the decision is operational timing.
- **ARCH-B4** — Flipping `promoteAsView` ON. Deletes the zombie/collision bug class. Flag ships OFF; needs validation that row-filter inheritance is correct before enabling.

**UX bets (the "magic + simplicity" investment):**
- **DES-Q1/Q3/Q4** — Control budget (collapsing 10-control headers, Agents double toggle). Quick-win tier, reversible.
- **DES-M1** — Unifying three promotion code-paths to one `<PromoteButton>`. Medium effort.
- **DES-M3/M6** — Proactive assistants + assistant-first default for Metrics/Dashboards. Pilot before OS-wide rollout.
- **DES-M4/DES-B1** — `orchestrate` intent + "What do you want to build today?" start screen. Bigger bet; `bigbets/planner.ts` already exists.
- **DES-B2/B4** — Hybrid retrieval and governed agent memory. The 2026-grade Context Librarian upgrade; `escalate` seam and `agent-memory.ts` seed already exist.

---

## Source Documents (for detail)

- Security findings detail: [`docs/code-review-security.md`](code-review-security.md)
- Maintainability findings detail: [`docs/code-review-maintainability.md`](code-review-maintainability.md)
- Readability/docs findings detail: [`docs/code-review-readability-docs.md`](code-review-readability-docs.md)
- Architecture assessment + technical bets: [`docs/code-review-architecture-future.md`](code-review-architecture-future.md)
- Design review (magic + simplicity): [`docs/design-review-2026-magic-simplicity.md`](design-review-2026-magic-simplicity.md)
