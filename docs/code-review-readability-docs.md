<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Code review — readability & documentation

**Scope:** READ-ONLY review of the Sovereign Agentic OS (`os-ui/` Next.js app, `docs/`,
per-module READMEs) for code readability and documentation quality — not correctness or
security. Reviewed 2026-08-22 against `os-ui 0.6.140` (released) / `0.6.151+` (Unreleased),
chart `0.2.0-alpha.11`.

**Verdict:** This is an unusually well-documented and well-commented codebase. The "why"
comment culture is genuine and load-bearing, not performative; the CHANGELOG and
ARCHITECTURE.md are reference-quality. The findings below are polish and drift-cleanup, not
overhaul. The single highest-value fix is regenerating the stale OS Guide / PDF.

---

## The genuinely strong work (credit where due)

- **`CHANGELOG.md` is exemplary.** Each entry names the exact file + function + root cause,
  and frequently the regression test that locks the fix. Example: the `0.6.141` entry cites
  `domainTableMissing()` in `lib/data/reconcile-server.ts`, `reconcileDomainTables()` in
  `lib/data/reconcile.ts`, the new `POST /api/platform-admin/reconcile-domain-tables` route,
  AND a "round-trip regression test (promote → served → demote → not served → re-promote →
  fail-closed)". This is how a changelog should read.
- **`lib/infra/governed.ts`** — the governed data spine. The module docstring (lines 9–26)
  cleanly separates the three concerns (OPA authz / execution / trace) and states the
  fail-closed contract. `scrubSecurityContext()` (lines 121–147) carries a comment that
  explains *why* it exists (Cube 400s on a filter member the cube lacks — "the Northpeak
  cohort cubes have no `region`"). That is a real bug-prevention comment, not narration.
- **`os-ui/ARCHITECTURE.md`** — the four-ring model (core / infra / tab / shared-service),
  the tab-module contract table, the strict one-way dependency rule, and an honest
  "Documented debt" + "Migration status" (Phases A–H) section. A new contributor can learn
  one tab and work any tab. Verified accurate (see Phase B check below).
- **Per-tab READMEs + `lib/tabs/*.context.md`** — the Connections README is the reference
  template and is outstanding (golden path, public API file-by-file, invariants, and it even
  names the test that enforces an invariant: `lib/mcp/mcpv2-p0.test.ts`). `data.context.md`
  is a precise, current tool-surface reference.
- **MCP tool descriptions are rich and current.** Tools like `adopt_exposed_table` and
  `list_exposed_tables` (`lib/mcp/exposure-write-tools.ts`) carry `Before:/After:` golden-path
  chaining hints and governance notes inline. These match `data.context.md` and the live tool
  names — no drift found in the sample.
- **Type discipline.** Effectively zero `as any` in non-test `lib/` code (the auto-pipeline
  has exactly one). Fail-closed is *typed*: `authorize()` returns `{allowed, policy}` where
  `policy: 'opa-unreachable'` means a caller cannot mistake a network error for a grant.
- **Top-level `README.md` + `docs/getting-started.md`** cross-link well and lead with a
  one-command quickstart and the recommended STACKIT path.

---

## HIGH priority

### H1 — The OS Guide (and its distributed PDF) is ~124 build-versions stale
- **Location:** `docs/Sovereign-Agentic-OS-Guide.md` line 5 (and the generated
  `docs/Sovereign-Agentic-OS-Guide.pdf`).
- **Drift:** The front-matter `date:` reads
  `"Chart 0.2.11 (app 0.2.0-alpha.11 · os-ui 0.6.31) …"` but the CHANGELOG is at
  `os-ui 0.6.155`. The Software tab moved to a declarative model (~0.6.130+) and the Agents
  builder to the 5-phase design since 0.6.31 — a reader of the PDF gets materially outdated
  tab descriptions. `{{DATE}}`/`{{GIT_COMMIT}}` are placeholders substituted at build time, so
  the `os-ui 0.6.31` string is a *hardcoded* value in the source that build-docs does not
  refresh.
- **Fix:** Update the hardcoded `os-ui 0.6.31` in line 5 to the current build stream (or make
  it a `{{OSUI_VERSION}}` placeholder that `scripts/build-docs.sh` stamps), then re-run
  `scripts/build-docs.sh` and commit both `.md` and `.pdf`. This matches the standing "keep OS
  guide updated" practice — the guide has simply fallen behind.

### H2 — The dual version scheme is undocumented (onboarding trap)
- **Location:** `os-ui/package.json` (`0.2.0-alpha.11`), `charts/sovereign-agentic-os/Chart.yaml`
  (`version: 0.2.11`, `appVersion: "0.2.0-alpha.11"`), vs `CHANGELOG.md` (`os-ui 0.6.155`).
- **Drift:** There are two independent version streams — the **product/chart release**
  (`0.2.0-alpha.11`) and the **os-ui build stream** (`0.6.x`, the granular per-wave numbers
  used everywhere in the CHANGELOG and in inline comments like `// os-ui 0.6.133`). Nothing
  explains this. A new engineer will read `package.json` as `0.2.0-alpha.11`, then see
  `0.6.155` in the CHANGELOG and code comments and assume something is broken.
- **Fix:** Add a short "Versioning" note to the top of `CHANGELOG.md` (or `README.md`)
  explaining the two streams and which artifact each lives in.

### H3 — No stores / persistence map for a new engineer
- **Location:** `os-ui/ARCHITECTURE.md` (the gap).
- **Issue:** ARCHITECTURE.md nails the *code* topology but never explains the runtime
  persistence model: the in-process store + OpenSearch **os-mirror** seam (`lib/infra/os-mirror.ts`),
  what survives a pod restart vs what re-hydrates, and how the "same `decide()` in the offline
  mirror and live OPA" invariant (cited in the Connections README) actually plays out. ADR
  `docs/decisions/0003-durability-os-mirror.md` exists but isn't referenced from the code map.
- **Fix:** Add a "Data durability & mirrors" section to ARCHITECTURE.md (a paragraph + a
  pointer to ADR-0003) covering the os-mirror seam and the hydrate-on-restart flow.

---

## MEDIUM priority

### M1 — `agents/store.ts` breaks the house import idiom
- **Location:** `os-ui/lib/agents/store.ts` (imports, lines ~1–21) vs `os-ui/lib/connections/store.ts`
  (lines 4–28).
- **Drift (verified):** `agents/store.ts` uses **relative paths with explicit `.ts`
  extensions** — `import { canPromote } from '../core/session.ts'`,
  `from '../governance/edit-scope.ts'` — while `connections/store.ts` (the reference template)
  and `software/apps.ts` use **`@/lib/*` aliases without extensions**
  (`from '@/lib/core/session'`). Two spellings of the same import raise cognitive load and
  make cross-file refactors grep-harder. Note `agents/store.ts` also imports `edit-scope` from
  `../governance/` (the re-export shim) rather than the canonical `@/lib/core/edit-scope`
  (see M4).
- **Fix:** Canonicalize `agents/store.ts` on `@/lib/*` aliases, no `.ts` extensions, and import
  `edit-scope` from `@/lib/core/edit-scope`. Cheap; makes the tab match its own contract.

### M2 — Timeout magic numbers scattered inline in the governed spine
- **Location:** `os-ui/lib/infra/governed.ts` lines 32 (`ms = 2500`), 165 (`2500`), 212/251
  (`8000`), 357 (`timeoutMs = 15000`).
- **Issue:** Each timeout is correct and even commented at the call site, but the policy lives
  in five inline literals. A latency-SLA change means grepping. (`config.syncStatementTimeoutMs`
  already shows the codebase *has* a config seam for this class of value.)
- **Fix:** Hoist named constants at the module head (`TIMEOUT_OPA_MS`, `TIMEOUT_CUBE_QUERY_MS`,
  `TIMEOUT_EXECUTE_MS`, …) with a one-line rationale each; keep the write path's explicit
  `timeoutMs` override.

### M3 — `deployment-editions-architecture.md` reads as current architecture
- **Location:** `docs/deployment-editions-architecture.md` line 2.
- **Issue:** It *does* carry `Status: design exploration (not shipped)` in body text, but the
  "Three editions" table that follows looks like an install-time choice. A new operator may not
  register the one-line caveat.
- **Fix:** Promote the status to a prominent callout at the very top: "⚠️ Design exploration
  only — the shipped stack is Sovereign Full (Kubernetes + Trino + Iceberg). For deployment
  today see `stackit-deployment-guide.md`."

### M4 — `edit-scope` shim + `canManageArtifact` fallback: acknowledged debt, invisible in code
- **Location:** `os-ui/lib/governance/edit-scope.ts` (re-export shim), `os-ui/lib/core/edit-scope.ts`
  (`canManageArtifact`, ~lines 44–58).
- **Issue (two small things):** (a) The shim is Phase-C debt per ARCHITECTURE.md line 112 but
  the file itself carries no task marker, so a reader can't tell intentional-shim from bug.
  (b) `canManageArtifact` treats `scope === 'personal'` explicitly then lets everything else
  fall through to the shared rule; the "unknown scope collapses to shared, fail-closed" intent
  is in the block comment but not in the control flow — a corrupt `scope:'invalid'` silently
  *widens* to the shared rule rather than denying.
- **Fix:** (a) Add a `// TODO(Phase C)` + one-line "@deprecated re-export shim" to
  `governance/edit-scope.ts`. (b) Make the default explicit: `const scope = art.scope ??
  'shared'` and end with an explicit `return false` for any unrecognized enum value.

### M5 — Cross-tab README template drift (`dashboards`, `knowledge`, `agents`)
- **Location:** `os-ui/lib/dashboards/README.md` (48 lines), `os-ui/lib/agents/README.md`
  (40), `os-ui/lib/knowledge/README.md` (45) vs the contract exemplars
  `connections/README.md` (62) and `data/README.md` (133).
- **Drift (verified):** The tab-module contract (ARCHITECTURE.md, README row) promises each
  tab README covers "what the tab does, its golden path, its public API, its invariants."
  `dashboards/README.md` has **no Invariants section** (connections/data/software do), and the
  shorter READMEs omit the seams/imports-from-other-tabs note. (Note: the peer READMEs are
  ~60–200 lines, not the "~600" an automated pass suggested — the gap is *sections present*,
  not raw length.)
- **Fix:** Add an Invariants section + a "seams (imports from other tabs)" line to
  `dashboards`, `agents`, `knowledge` READMEs to match the connections template.

---

## LOW priority

### L1 — `agent-governed.ts` section references assume out-of-band docs
- **Location:** `os-ui/lib/infra/agent-governed.ts` (comments referencing "Agent golden path
  §1, §7", "Software golden path §4", etc.).
- **Issue:** The `§N` references are meaningful to insiders but unresolvable for a newcomer —
  no path/anchor given.
- **Fix:** Add one module-head docstring mapping `§N → docs/<file>#<anchor>` so the references
  are followable once.

### L2 — Offline policy mirror (`LOCAL_GRANTS`) unmarked as teaching-only
- **Location:** `os-ui/lib/infra/agent-governed.ts` (~lines 70–93).
- **Issue:** The fallback grant table hardcodes demo principals (`sales-assistant`,
  `churn-model`, …). It only fires under `OPA_FAIL_OPEN`, but nothing at the definition says
  "teaching-flow only; never fires in production."
- **Fix:** Add a WARNING docstring above `LOCAL_GRANTS` stating it applies only when OPA is
  unreachable in the offline teaching flow and must never carry production principals.

### L3 — Import-list wall at the top of `connections/store.ts`
- **Location:** `os-ui/lib/connections/store.ts` (opening ~200 lines are adapter imports).
- **Issue:** 20+ connector adapters imported flat with no grouping; the actual store logic is
  far down the file. Not wrong, just navigation-heavy for the reference template.
- **Fix:** Group the adapter imports by family (SaaS / data-platform / identity / drive) with a
  one-line banner comment each.

### L4 — No end-to-end "how a governed query flows" narrative, and `.context.md` files aren't discoverable
- **Location:** `docs/` (gaps).
- **Issue:** The mechanism is spread across ARCHITECTURE.md, `governed.ts`, and
  `data.context.md`, but there's no single 5-step walk-through (browser → route →
  `infra/governed` authorize→act→trace → OPA → Trino RLS → result). Separately, the excellent
  `lib/tabs/*.context.md` golden-path docs live under `os-ui/lib/` and are never linked from
  `docs/`, so an MCP user or new agent-builder won't find them.
- **Fix:** Add `docs/governed-query-path.md` (short narrative + the trace tags the spine
  stamps), and a `docs/mcp-tool-reference.md` index that links every `lib/tabs/*.context.md`.
- **Optional (L5):** A 30–50 line `docs/RELEASE-NOTES.md` summarizing the last ~3 releases —
  the 455 KB CHANGELOG is superb for depth but heavy for "what changed since I last deployed."

---

## Verified claims (spot-checks run during this review)

- **Governed-spine consistency:** stores route mutations through `authorize`/`governed`/`decide`
  as ARCHITECTURE claims (connections 37 authorize refs, bigbets 9, knowledge 4, metrics 2 —
  proportional to write surface).
- **Phase B migration status is accurate:** only `lib/notifications` lacks `index.ts`; only
  `lib/marketplace` + `lib/notifications` lack `schema.ts` — exactly the "Phase B planned"
  remainder ARCHITECTURE.md describes.
- **Code smells are genuinely low:** 7 `TODO/FIXME` markers in all of `lib/` (each scoped,
  e.g. `TODO(merge-to-main)` in `agents/build/live-clients.ts`), essentially zero `as any` in
  non-test code, no commented-out code blocks in the core files sampled.
- **MCP tool names match docs:** `query_data`, `list_exposed_tables`, `adopt_exposed_table`
  in `data.context.md` are the real registered tool names in `lib/mcp/exposure-write-tools.ts`.

## Highest-value actions, in order

1. **H1** — regen the OS Guide + PDF (users read a 0.6.31-era document today).
2. **H2 / H3** — document the dual version scheme and add a persistence/os-mirror map to
   ARCHITECTURE.md (the two biggest onboarding gaps).
3. **M1 / M5** — align `agents/store.ts` imports and fill the missing README Invariants
   sections so the "every tab is shaped the same" promise holds in practice.
4. **M4** — make the two fail-closed intents (edit-scope shim marker + unknown-scope default)
   explicit in code, not just comments.
