<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Code review — maintainability, complexity, technical weaknesses

Staff-engineer review of the Sovereign Agentic OS (`os-ui/` Next.js app + Helm
stack). Read-only. Scope: architecture & module boundaries, over-engineering,
fragility, testing, dependencies. Grounded in the code as of `os-ui@0.2.0-alpha.11`
(app-internal build tags up to ~0.6.155).

**Headline:** this is a genuinely well-disciplined codebase — a clean layered
contract, ~5,755 unit tests, honest fail-closed governance, one shared durable-mirror
core, and no meaningful dead code. The real weaknesses are structural and concentrated:
(1) a durability model that is *in-memory-authoritative* with a best-effort mirror,
which hard-caps the OS at **one replica** and leaves several platform-admin stores
**fully volatile**; (2) an architecture invariant (no cross-tab internal imports) that
is **documented but not enforced** — violated ~49 times; (3) a handful of **2,000+ line
god-components**; (4) **deploy tooling built from 55 one-off scripts** around a fragile
`helm --reuse-values` flow.

---

## What is genuinely well-built (credit)

- **The three-layer module contract** (`ARCHITECTURE.md`): `core → infra → tab`, with
  shared services layered above. It is real, mostly inhabited, and documented down to a
  per-file table (`index/schema/store/<feature>/test/README`). A contributor who learns
  one tab can work on any tab. This is the load-bearing good idea.
- **The governed spine** (`lib/infra/governed.ts`): every data tool (Cube `metrics`,
  Trino `query`) funnels through one `authorize → run → trace`. OPA is **default-deny and
  fail-closed** — `opaFailOpen` defaults `false` (`lib/core/config.ts:408`), fail-open is
  an explicit opt-in for the offline teaching flow only. This is the honest security
  posture the memory notes credit ("honesty gate").
- **One shared durable-mirror core** (`lib/infra/os-mirror.ts`): the artifact-loss-on-deploy
  incident was fixed *once*, centrally — a missing index is now CREATED on 404 instead of
  being mistaken for a dead mirror. Excellent that this is not copy-pasted per store.
- **Test discipline**: ~5,755 test cases across 584 test files, co-located, IO-injected so
  pure logic tests without a cluster. The **route-guard tripwire** (`lib/security-route-guards.test.ts`)
  is a standout: it source-scans every `app/api/**/route.ts` and fails if a handler carries
  neither an inline gate nor `withRoute(` — compensating cleverly for the fact that Next
  route handlers can't be imported under `node --test`.
- **No dead code.** A dedicated sweep found no truly dead exports; even the "dormant" Kaniko
  build path is fully implemented, tested, and honestly flagged (see F5).
- **`ChooseContextShell`** is the right dedup pattern (agents + software share it); the
  promote/lifecycle helpers are unified in `lib/governance`, not copy-pasted.

---

## Fix now

### F1 — Platform-admin settings & several admin stores are fully volatile (no mirror)  · High · S
**Location:** `lib/platform-admin/settings.ts:70` (`let settings`), and confirmed **zero**
`osMirror`/`writeThrough` in `settings.ts`, `security.ts` (egress allowlist + request queue),
`tenant.ts` (per-tenant config), `plugins.ts` (marketplace registration + plugin approvals).

The `settings` object is a bare module-level `let`. `updateSettings()` mutates it in place;
the route (`app/api/platform-admin/settings/route.ts:24`) calls it and **writes an audit row**
— but the setting itself never persists. So `promoteAsView`, `autonomousAgentsEnabled`,
`codedAppsEnabled`, `standardFirstEscalation`, model-role pins and SSO config **silently revert
to defaults on every redeploy** (this surfaced live). Worse: the audit log records
"settings.update" while the durable state is unchanged — **the audit trail lies about
durable configuration**. `security.ts`/`tenant.ts`/`plugins.ts` are the same class of bug:
egress approvals, tenant budgets/locale, and plugin approvals all evaporate on restart.

**Recommendation:** give these four stores the same `osMirror` write-through + boot hydration
that data/agents/connections/etc. already use (index e.g. `os-settings`, `os-egress`,
`os-tenants`, `os-plugins`). This is a ~1-file-each change with a proven template. Highest
value-for-effort finding in the review — a security-relevant flag that reverts to a *safer*
default is a lucky accident, not a design.

### F2 — In-memory-authoritative durability caps the OS at one replica  · High · L (future) / S (guardrail now)
**Location:** durability model in `lib/infra/os-mirror.ts:7-30`; `charts/.../os-ui/os-ui.yaml:102`
(`replicas: 1`); ~70 stores use the `globalThis`-Symbol authoritative-Map pattern.

The design is: **each store's in-process Map is authoritative; OpenSearch is a best-effort,
fire-and-forget mirror** that hydrates only *once at boot*. Consequences:
- **Writes are fire-and-forget and never replayed.** A write while the mirror is unhealthy is
  dropped; `os-mirror.ts` is explicit — "Earlier dropped writes are NOT replayed." A mirror
  blip during a burst of writes = silent divergence between memory and the durable copy.
- **A second replica diverges immediately.** Two pods = two authoritative Maps that only ever
  reconcile at their own boot. `replicas: 1` is hard-coded precisely because of this — it is a
  *mitigation, not a scale target*. The OS **cannot be scaled horizontally** without a redesign,
  and a single pod is a single point of failure with a "last boot" recovery point.

**Recommendation (now):** document the single-replica constraint as a hard invariant next to
the replica count, and add a startup assertion / readiness note so nobody bumps `replicas` and
gets silent corruption. **Recommendation (future direction):** for the stores that are genuinely
shared mutable state (approvals, datasets, agents, settings), move to *mirror-authoritative*
(read-through on miss, synchronous ack on the write path) or a real shared store (Postgres is
already in the stack for other components). Until then, treat every "PERSISTED" store as
"durable *only if the mirror was healthy at write time, and only under one replica.*"

### F3 — The "no cross-tab internal imports" invariant is documented but unenforced  · Med · M
**Location:** `ARCHITECTURE.md:45-50` states the one rule "code review rejects." Reality: **~49
sideways imports** into other tabs' internal files (not their `index.ts`). Worst offenders by
target: `governance` (11), `agents` (11), `connections` (8), `data` (6). Concrete examples:
- `lib/metrics/store.ts:4` imports `getDataset, listDatasets, peekDatasetMeasureNames` straight
  from `../data/store.ts`.
- `lib/governance/effects.ts` reaches into `data/store.ts`, `data/publish.ts`, `knowledge/store.ts`,
  `knowledge/personal-store.ts`, `agents/store.ts`.
- `lib/data/store.ts:44`, `sync-cron.ts`, `dataset-schema.ts` all import `agents/cron-util.ts`
  directly; `knowledge/consumers.ts` imports `software/apps.ts` + `agents/store.ts`.

These are the real coupling the contract exists to prevent. Some are benign leaf utilities
(`cron-util`, `edit-scope` — already lifted to `core` for exactly this reason), but
`metrics→data/store` and `governance→every tab's store` are genuine god-module tentacles.

**Recommendation:** either (a) enforce the rule with a cheap lint/tripwire test in the same
style as the route-guard test — grep every `lib/<tab>/*` for `from '../<othertab>/` where the
target isn't `index.ts` and fail — then whitelist the handful of deliberate `core`-bound leaf
utils; or (b) honestly downgrade the wording in ARCHITECTURE.md from "the one thing code review
rejects" to "the direction we're migrating toward," since today it is aspirational. Option (a)
is better: without a tripwire this will keep drifting.

### F4 — 2,000+ line god-components  · Med · M
**Location:** `components/software/SoftwareBuilder.tsx` (2,543 lines, 47 hooks, 58 fns),
`components/data/DataBuilder.tsx` (2,231 lines, **99** hook calls),
`components/software/appspec/AppSpecComposer.tsx` (2,159),
`components/agents/SimpleBuilder.tsx` (1,692, 53 hooks),
`components/agents/BuildRunPanel.tsx` (1,463). On the lib side:
`lib/software/apps.ts` (3,473 lines, **71 exported fns**), `lib/connections/store.ts` (3,090, 37),
`lib/data/store.ts` (1,882, 58).

99 hook calls in one component is a maintainability hazard — state that large is hard to reason
about, review, and test, and it violates the ARCHITECTURE.md promise that `page.tsx` is "thin,
no business logic." `apps.ts` at 71 exports is a store that has become a catch-all.

**Recommendation:** decompose the top offenders by *stage* (these are staged builders — each
stage is a natural component + hook module) and extract per-concern sub-stores from `apps.ts`
(build, records, preview, review are already separate files elsewhere — `apps.ts` should
delegate, not host). Not urgent, but these files are where future bugs will hide. Prioritise
`DataBuilder.tsx` (99 hooks) and `apps.ts` (71 exports).

### F5 — Deploy tooling: 55 one-off scripts + fragile `--reuse-values`  · Med · S–M
**Location:** `scripts/deploy-06XX.sh` × 55, `scripts/public-sync-*.sh` × 17. Sample
(`scripts/deploy-06155.sh`): `helm upgrade --reuse-values --force-conflicts --set
osUI.image.tag=...` followed by a hand-written *"force the pod to actually cycle (helm
--reuse-values has left a stale pod before)"* step.

This encodes two known fragilities: (1) `--reuse-values` reverts any value set out-of-band
(the separately-rolled query-tool image — see memory note), and (2) a template that doesn't
change means the pod doesn't roll, so a manual `rollout restart` is bolted on. Fifty-five
near-identical version-stamped scripts is copy-paste accumulation — the exact anti-pattern the
`os-mirror` refactor eliminated on the lib side.

**Recommendation:** collapse to **one** parameterised `deploy.sh <version>` that (a) renders a
values file rather than `--reuse-values` (or uses `helm upgrade --install -f values.<env>.yaml
--set image.tag`), and (b) always does an explicit `kubectl rollout restart` + `rollout status`
so "did the pod actually cycle" is deterministic, not folklore. Delete the 55 historical scripts
(git history preserves them).

---

## Future direction (not blocking)

### D1 — Route testing is source-shape only; no behavioural/integration coverage  · Med · L
The ~5,755 tests are almost entirely lib unit tests. Route coverage is **one** test
(`security-route-guards.test.ts`) that asserts *the guard is textually present*, not that it
*behaves* (correct 401/403, RLS actually filters, governance ladder actually denies a creator's
promote). Component tests: 6 total across the whole `components/` tree. The governance ladder
(Personal→Shared→Certified, role floors incl. `domain_admin`) is the highest-stakes logic and is
proven only at the unit level. **Recommendation:** add a thin integration layer that boots the
route handlers against fake infra (the IO is already injected) and exercises the deny paths for
each role — this is where a real regression would land undetected today. Tag as Phase C
(access-control audit) which ARCHITECTURE.md already plans.

### D2 — `withRoute` migration is early (56/346 routes)  · Low · M
Only 56 of 346 routes use the `withRoute(` wrapper; the rest carry inline gates. Not a defect
(the tripwire proves they're guarded), but two gate mechanisms coexisting is a consistency tax.
Finish the migration so there is one guard pattern.

### D3 — Documented-debt modules still mis-placed  · Low · S
`lib/superset`, `lib/powerbi`, `lib/git` are external-service clients living as "shared services";
ARCHITECTURE.md:52-56 already admits they belong under `lib/infra`. They're small (~2k lines
combined). Move them when convenient so the layer diagram matches the tree.

### D4 — BuilderShell adoption is partial  · Low · S
The "OS-wide staged BuilderShell" is used by SimpleBuilder, DataBuilder, SoftwareBuilder,
ModelBuilder (`StageShell`), but **not** MetricBuilder, ConnectionBuilder, DashboardBuilder.
Either migrate the stragglers or note them as intentionally-different in the Builder Framework
doc, so "OS-wide" is true or explicitly scoped.

---

## Complexity / over-engineering — assessment: LOW

Contrary to the brief's hypothesis, this codebase is **not** over-engineered:
- **The Kaniko/build-service path is dormant-but-complete, not half-built.** `lib/software/build-service.ts`
  is fully implemented and tested (`build-service.test.ts`, `build-stage.test.ts`), gated OFF by
  `softwareBuildEnabled` (default off), and honestly documents its fallback (`BUILD_SERVICE_OFF_NOTE`).
  Path A (Forgejo Actions, `refreshActionsStage`) always runs; Path B runs only when the flag is on.
  This is a *clean feature flag*, not parallel rot. (The memory note "dormant + unfinished" appears
  to under-credit how complete it is — the risk is operational-enablement, not code debt.)
- **Feature flags** (`codedAppsEnabled`, `promoteAsView`, `autonomousAgentsEnabled`) are each
  enforced fail-closed at multiple entry points (UI + API + MCP), not speculative branches.
- **No duplicated context-picker / promote-helper sprawl** — the recent `ChooseContextShell`
  extraction is representative of the codebase's direction.

The one over-engineering-adjacent smell is **god-modules** (F4) and the **55 deploy scripts**
(F5) — accumulation, not speculation.

---

## Dependencies — assessment: HEALTHY

25 runtime deps. The heavy ones are all justified by a real feature and not duplicated:
`monaco-editor` (98M — the code editor), `echarts` (54M — native Cube dashboards, the chosen
alternative to the dropped Superset iframe), `esbuild-wasm` (23M — in-browser app-preview
compilation for the Software tab), `jspdf` (29M — agent/knowledge PDF export), `@xyflow`
(agent graph). No two libraries do the same job; no obvious bloat to drop. License-checker is
wired into CI. Leave as-is.

---

## Finding index

| # | Finding | Impact | Effort | Location |
|---|---|---|---|---|
| F1 | Platform-admin settings + security/tenant/plugins fully volatile (no mirror) | High | S | `lib/platform-admin/settings.ts:70`, `security.ts`, `tenant.ts`, `plugins.ts` |
| F2 | In-memory-authoritative durability → one-replica ceiling + fire-and-forget writes | High | L (fix) / S (guardrail) | `lib/infra/os-mirror.ts:7`, `charts/.../os-ui.yaml:102` |
| F3 | Cross-tab internal-import invariant documented but unenforced (~49 violations) | Med | M | `ARCHITECTURE.md:45`; e.g. `lib/metrics/store.ts:4`, `lib/governance/effects.ts` |
| F4 | 2,000+ line god-components / 71-export store module | Med | M | `components/data/DataBuilder.tsx` (99 hooks), `lib/software/apps.ts` (71 exports) |
| F5 | 55 one-off deploy scripts + fragile `helm --reuse-values` | Med | S–M | `scripts/deploy-06*.sh`, `scripts/deploy-06155.sh` |
| D1 | Routes/governance have source-shape tests only, no behavioural coverage | Med | L | `lib/security-route-guards.test.ts` (sole route test) |
| D2 | `withRoute` migration early (56/346) | Low | M | `app/api/**/route.ts` |
| D3 | superset/powerbi/git mis-layered (self-admitted) | Low | S | `ARCHITECTURE.md:52` |
| D4 | BuilderShell adoption partial (4 of 7 builders) | Low | S | `components/{metrics,connections,dashboards}/*Builder.tsx` |
