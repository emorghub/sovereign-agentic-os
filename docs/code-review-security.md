# Security Code Review — Sovereign Agentic OS

**Reviewer:** Senior security engineer (read-only review)
**Date:** 2026-08-22
**Scope:** Whole repo, focused on governance/authz, authN/identity, tenant isolation, agent/app governance, injection/sandboxing, and secrets. Canonical paths only (`os-ui/`, `images/`, `charts/`, `deploy/`, root `values*.yaml`); `.claude/worktrees/` stale copies ignored.

---

## Executive summary

This is a **mature, defense-in-depth governed OS**, and the review credits that up front: the enforcement floors that matter are real, server-side, and fail-closed. The strongest properties:

- **Trino→OPA is the true data floor.** Row filters + column masks are computed from the accessing principal's identity (the Trino session user), not from a request field, so a spoofed identity field cannot read past what that principal is entitled to. The `personal_*` hard-deny and the external-catalog fail-closed floor are genuine, identity-derived, and additive (deny-only).
- **Identity is server-derived.** Sessions are HMAC-verified (`auth.ts`/`session.ts`); `principal/uid/domains/role` sent to the query-tool are derived from `requireUser()`, never the browser. Active-domain narrowing is subset-only (can never widen).
- **Tool access is default-deny** (`agentic.authz`: `default allow := false`), role floors use ranked `roleAtLeast` (the MEMORY `{builder,admin}`-drops-`domain_admin` bug is remediated), and the agent run-context gate is a **structural in-process intersection** of grants ∩ runner rights, not a prompt.
- **Secrets discipline holds:** a server-only vault stores refs not values, the settings adapter refuses raw secrets, a boot guard crash-loops prod on dev-default signing secrets, and no real production credentials are committed.

The exposures cluster on the **write/promotion path and the infra/network posture**, not on the read floor. Top items to act on: unvalidated requester-supplied grants at promotion approval (HIGH), and the disabled-by-default service bearer combined with an open intra-namespace network (HIGH in a real deploy).

### Findings by severity

| # | Sev | Area | Location | One-line |
|---|-----|------|----------|----------|
| H0 | **High** | SQL injection | `os-ui/lib/metrics/model.ts:123,202` | Metric `column`/`filter.column` only `.trim()`'d (not IDENT-validated) → injected expression/subquery reaches executed Trino SQL. Contained to caller's own OPA-governed reads (hence High, not Critical). |
| H1 | **High** | Tenant isolation | `os-ui/lib/data/store.ts:1560` (also 1408, 1679) | Requester-supplied `req.grants` persisted verbatim at approval → cross-domain / named-user grant injection. |
| H2 | **High** (live deploy) | Infra / authN | `charts/.../values.yaml:1131,2139`; `agent-runtime/agent-runtime.yaml:11`; `images/query-tool/app.py:57`; `network/egress-policies.yaml:58-70` | Static runtime bearer ships on the live deploy (stays on `profile:local`); service bearer off by default + no Ingress NetworkPolicy → any in-namespace pod can forge scheduled runs and write-path identity (`role:"admin"`). |
| H3 | **High** | Sandboxing | `os-ui/components/ToolWindow.tsx:151-157` | Embedded first-party platform tools run same-origin (`allow-same-origin allow-scripts`) → XSS/compromise in any tool executes in the OS origin as the user. |
| M1 | Medium | Agent gov | `os-ui/lib/software/app-records.ts:82` | Agent-initiated `os.records.*` writes default auto-approve and bypass the write-approval hold (blast radius domain-contained). |
| M2 | Medium | Tenant isolation | `os-ui/lib/data/build/live-clients.ts:280`; `trino.rego:141` | Promotion-release keyed by schema alone → concurrent-promotion race + exemption broader than one table. |
| M3 | Medium | Secrets | `charts/.../templates/terminal/terminal.yaml:113`, `workbench/workbench.yaml:127` | Broker secret not profile-gated → enabling terminal/workbench without `brokerSecret` ships a world-known token. |
| M4 | Medium (defense-in-depth) | Governance | `charts/.../policies/trino.rego:33` + `215,220-223` | A compiler-missed non-personal `iceberg.*` table is world-readable (fail-closed floor excludes internal catalogs). |
| M5 | Medium (by design) | App sandboxing | `os-ui/lib/software/app-runtime.ts:139` | Runtime apps run `allow-scripts allow-same-origin` in the OS origin → app JS acts as the user (defended only by server-side governance, not origin isolation). |
| M6 | Medium | AuthN | `os-ui/lib/mcp/token.ts:105-111` | `resolveMcpUser` checks `mustChangeCredentials` but NOT `u.disabled` → a deactivated user's 180-day MCP token keeps resolving. |
| M7 | Medium | SSRF | `images/web-fetch/app.py:39-44` | web-fetch validates hostname but never re-checks the resolved IP (no DNS-rebind / redirect guard); the existing `secrets.ts` IP denylist isn't reused. Bounded by the tinyproxy allowlist. |
| M8 | Medium | DoS | `os-ui/app/api/data/datasets/[id]/ingest/route.ts:28`; `files/route.ts:58` | Large multipart body buffers into pod memory before the post-parse size rejection; `content-length` is client-controlled. Ingress `proxy-body-size` is the real cap. |
| M9 | Medium | Prompt injection | `os-ui/lib/bigbets/planner.ts:119-138` | LLM-proposed `consumes` artifact IDs persisted without a per-caller scope check (durable cross-domain-reference leak; UI redacts on read). |
| L1 | Low | Tenant isolation | `os-ui/lib/data/store.ts:1470-1485` | Builder-owner can self-approve their own promotion (SoD advisory, not enforced). |
| L2 | Low | Agent gov | `os-ui/lib/software/app-records.ts:62` | Empty-string `actor.domain` fallback is latent Domain-read widening. |
| L3 | Low | AuthN | `os-ui/lib/core/config.ts:86` | Hardcoded dev-default `AGENT_RUNTIME_TOKEN` (superseded by H2 — it actually ships). |
| L4 | Low | Secrets | `values.dbt-git.yaml:110` | Inline `REPLACE_WITH_FORGEJO_ADMIN_PASSWORD` literal instead of `secretKeyRef`. |
| L5 | Low | Governance | `charts/.../policies/marketplace.rego:51` | `rls_engine` informational only; unknown `mode` leaves it undefined (no live gap). |
| L6 | Low | Prompt injection | `os-ui/lib/assistant/page-context.ts:99-107` | Untrusted artifact names/goals interpolated into assistant prompts unlabeled (contained by the authoritative tool gate). |
| L7 | Low | Sandboxing | `os-ui/next.config.mjs` | No top-level CSP on OS UI routes that use `dangerouslySetInnerHTML` (Markdown, components page). |

---

## Strengths (credited)

- **Governed-write door is two independent gates before Trino** (`images/query-tool/execute_guard.py`): a tight statement allowlist (single statement, no comments, no stacked statements, shape-matched regexes) + a target-schema/role floor (builder for domain schemas, `personal_<uid>` for the owner). The CTAS/INSERT/MERGE reads run **as the caller's principal**, so a build can only read what the builder may read (`connect_kwargs`, unit-tested).
- **Read path is strongly isolated**: server-derived principals, an identity-only `personal_*` hard-deny (`trino.rego:126,175-180`), fail-closed cross-domain row filters, and an external-catalog fail-closed floor (zero rows + write-deny for ungoverned non-internal catalogs).
- **OPA-unreachable → deny** at both the tool boundary (`governed.ts:47-62`) and the data spine, gated behind an `OPA_FAIL_OPEN` env that defaults **off**.
- **Agent double-gate** (`os-ui/lib/agents/build/os-tools.ts:638,652,705`): ungranted tool → `not_found` before OPA; every call dispatches through `handleRpc(user, …)` under the acting user's identity re-checking role floor + OPA/DLS/RLS. True grants ∩ runner-rights intersection.
- **Delegated identity loaded live at run time** (`scheduled.ts:39`, `system-schema.ts:343`): scheduled runs read the owner's *current* role/domains, refuse disabled/setup-incomplete owners, and downgrade stale write-bounded grants — a lower-priv owner cannot be used to run a higher-priv job.
- **Separation of duties on approvals** is server-enforced as the **approver's** identity with a double-decision race guard (`app/api/governance/approvals/route.ts:63,108-113`; `approvals.ts:213`).
- **App write door is domain-contained** (`app-records-store.ts:91`, `app-records.ts:160`): records stamp server-derived `owner`/`domain`, scoped by `appSlug`; apps cannot create datasets or write cross-domain.
- **Autonomy is a fail-closed tenant-admin platform flag** (`settings.ts:81`, `scheduled.ts:72`, `requireAdmin` = `role==='admin'`).
- **Custom-block sandbox is null-origin** (`os-ui/lib/software/appspec/sandbox.ts`): `allow-scripts` WITHOUT `allow-same-origin` + strict CSP (`connect-src 'none'`) → custom HTML/JS can never act as the user or reach OS APIs. Proper `<script>`/`</script>` and U+2028/2029 neutralization.
- **Secrets:** secretRef vault (`secrets.ts:36-40`), settings adapter rejects raw secrets (`settings.ts:95-98`), boot guard crash-loops prod on dev-default signing secrets (`config.ts:673-691` + `instrumentation.ts:39-45`), SSRF egress guard hard-denies `169.254.169.254`/link-local/loopback even if allowlisted. No committed prod credentials; gitleaks + gitignore correctly scoped.
- **Egress is deny-by-default**: `default-deny-egress` NetworkPolicy + a single tinyproxy chokepoint (`FilterDefaultDeny Yes`) with a domain allowlist; the agent-runtime and Hermes gateway are excluded from the blanket intra-namespace allow and locked to LiteLLM + os-ui `/api/mcp` only.

---

## Findings (detail)

### H0 — High — SQL injection via unvalidated metric column into executed Trino SQL

**Origin:** `os-ui/lib/metrics/model.ts:123` (`filterSql`: `const col = `{CUBE}.${f.column}``) and `:202` (`sql = ... form.column.trim()`). The metric `name` is slugged (`measureName`) and formula refs are validated (`assertFormulaRefs`, `:178`), but `form.column` and `form.filter.column` are only `.trim()`'d — never IDENT-validated nor checked against the dataset's real gold columns.

**Persisted + executed:** `measureFromForm` → `defineMeasure` (`store.ts:1282`) stores `measure.sql` verbatim; `metric-write-tools.ts:237` IDENT-checks only the name. At query time `explorer.ts:154-170` interpolates it into `SUM(CAST(${m.sql} AS double))` / `FILTER (WHERE ${f.sql})`, which flows through `explore-server.ts:190 queryRun(sql)` → `/query` → real Trino (dashboards and alert-eval share this path).

**Why the backstop misses it:** `execute_guard.py:166 guard_read` rejects `;` and comments, but a column value like `x)) OVER () AS a, (SELECT secret FROM other_table` injects an expression/subquery with no `;`.

**Risk (and why High, not Critical):** a creator (the min role for `define_metric`) can inject arbitrary read expressions/subqueries into the executed SELECT. This defeats the "guided, no-hand-written-SQL" contract. It is **contained** by the fact that the read still runs as the caller's own Trino principal under OPA row/column governance — the attacker can only reach data they are already entitled to, so it is not a cross-identity privilege escalation. That containment is the reason it is rated High rather than Critical.

**Remediation:** validate `form.column`, `form.filter.column`, and every ratio/formula column ref against the dataset's actual gold column set, and/or IDENT-check + quote them exactly like the sibling builders already do — `qcol()` in `os-ui/lib/data/transform.ts:79-89` (`if (!IDENT.test(id)) throw …; return `"${id}"``). Do it server-side in `measureFromForm`/`defineMeasure` before persisting `measure.sql`.

### H1 — High — Requester-supplied grants persisted verbatim at promotion approval

**File:** `os-ui/lib/data/store.ts:1560` — `d.grants = req.grants;` (also `1408`, `1679`).

`PromotionRequest.grants` originates from the **requester** (`requestPromotion`, `store.ts:1440,1458`). At approval, `applyApprovedPromotion` assigns them straight onto the dataset with no check that the approver may grant to those grantees. `validatePromotion` (`store.ts:1470-1485`) checks approver role + domain + transparency but never inspects `req.grants`. Those grants flow into `governanceFor(d)` (`policy/compiler.ts:46-49`) → `shared_with` / `shared_with_users` → the OPA `data.governance.tables` bundle, where `table_entitled` honors them (`trino.rego:254-266`).

**Risk:** a requester can inject `{grantee:{kind:'user', id:'<anyone>'}}` or `{grantee:{kind:'domain', id:'<any-other-domain>'}}`. On a routine Builder rubber-stamp the dataset is now shared cross-domain / to a named individual the approver never intended — including the requester injecting their own id into a domain they don't belong to. This is exactly the "add a false `shared_with_users` entry" bypass.

**Remediation:** in `validatePromotion` (or before `d.grants = req.grants`), validate each grant against the approver's authority — reject `domain` grantees not in `approver.domains` (require admin for cross-tenant), surface named-user grants for explicit approver confirmation, and normalize/re-derive grants server-side against a per-approver allowlist instead of `= req.grants`.

### H2 — High (confirmed on the live deploy) — Static runtime bearer + fail-open service bearer + open intra-namespace network

Three coupled infra weaknesses that together make **network reach == identity** for the governed data plane and the run-as-owner endpoints.

**(a) Static runtime bearer actually ships.** `charts/.../values.yaml:1131` sets `agentRuntime.token: "agent-runtime-local-dev-token"`, rendered inline by `agent-runtime/agent-runtime.yaml:11,26` **only when `global.profile == "local"`, with NO `randAlphaNum` fallback** (contrast `os-ui-session.yaml:24` / `service-bearer-token.yaml:26`, which both `default (randAlphaNum 48)`). The live public overlay `deploy/values.stackit-deploy.yaml` sets neither `profile: stackit` nor a token override, and the migration script uses `--set global.profile=local` — so the live deploy runs `NODE_ENV=production` with `OS_PROFILE=local`, and the **well-known static token is what renders in production**. The `assertNoDevDefaultSecretsInProd` boot guard (`config.ts:673-691`) covers only `OS_SESSION_SECRET` + `OS_MCP_TOKEN_SECRET` — NOT `AGENT_RUNTIME_TOKEN`. This bearer is the sole auth for `agents/scheduled-run/route.ts:22` (runs an agent **as the owner's live identity**), `agents/tool/route.ts:62` (governed-tool chokepoint), and `data/datasets/[id]/sync/route.ts:47`. Anyone who can reach `os-ui:3000` in-cluster and knows the constant can forge governed runs under any resolvable owner.

**(b) Service bearer off by default.** `charts/.../values.yaml:2138-2140` (`serviceBearer.enabled: false`, absent from all prod values so it stays off); `images/query-tool/app.py:57-58` returns `True` for everyone when unset (banner: "auth DISABLED — NetworkPolicy is the only boundary"). The data-plane services (query-tool, data-runner) then trust the **principal/role/domains in the request body**.

**(c) No default-deny Ingress; open intra-namespace egress.** `charts/.../templates/network/egress-policies.yaml:58-70` — `allow-intra-namespace-egress` is `podSelector:{}` → `podSelector:{}`, and there is no Ingress policy on query-tool (`lakehouse/query-tool.yaml` — cluster-reachable Service). So any pod in the namespace can POST directly to `query-tool:8000/execute`.

**Combined risk:** the read floor holds (a forged `principal` is just a different Trino session user OPA still governs). BUT `/execute`'s target/role gate (`execute_guard.py:307-333`) trusts the body `role`/`domains`: an in-namespace attacker sends `role:"admin"`, `domains:["<victim>"]`, sets `principal` to the victim domain too, passes the query-tool gate and the coarser rego write floor (`trino.rego:80-91`), and runs an allowlisted CTAS/DROP against any domain schema — a **write-path domain-integrity bypass** — plus can drive owner-scoped scheduled runs via (a). NetworkPolicies are also inert on kindnet (local) and only enforced on Cilium (STACKIT prod), so (c) is the sole boundary exactly where it's weakest.

**Remediation:** (1) give `agent-runtime.yaml` the `lookup`+`randAlphaNum 48` self-generation the other secrets use, or add `AGENT_RUNTIME_TOKEN` to the prod boot guard so the app refuses the dev default under `NODE_ENV=production`. (2) Set `serviceBearer.enabled: true` in production values (fully wired, just off). (3) Add a default-deny **Ingress** NetworkPolicy on query-tool + data-runner selecting only os-ui; consider refusing to start without a bearer off the `local` profile.

### H3 — High — Embedded platform tools run in a same-origin iframe

**File:** `os-ui/components/ToolWindow.tsx:151-157` — `src={`/tools/${active.key}/…`}` (same origin) with `sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"`. `allow-same-origin` + `allow-scripts` = the frame runs in the OS origin.

**Nuance:** `/tools/<key>` is a `requireUser()`-gated reverse proxy to a **fixed registry of admin-deployed first-party tools** (Superset, Langfuse, code-server, …), not end-user content — so it is not directly attacker-controlled by a low-priv user. It is a defense-in-depth weakness: an XSS or compromise in any embedded first-party tool executes in the OS origin and can read `/api/auth/me`, the session cookie, and call the OS API as the user. High (not Critical) because the content is first-party infra.

**Remediation:** drop `allow-same-origin`; serve each tool from its own subdomain/origin and pass credentials via the proxy/SSO (as Langfuse SSO already does) rather than ambient same-origin access.

### M1 — Medium — Agent `os.records.*` writes bypass the write-approval hold and default auto-approve

**File:** `os-ui/lib/software/app-records.ts:82` — `if (app.recordWritesRevoked !== true) return { ok: true };` (default-ON). Agent path: `[id]/tool` → `callAppTool` (`app-tool-call.ts:45`) authorizes against the app's auto-MCP capability profile, NOT the `os.records.*` envelope gate and NOT the `holdDecision` write-hold in `os-tools.ts`.

**Risk:** an app whose auto-MCP profile lists record tools as allow/`Read` (or an in-memory app with only the dynamic app-registry grant → flat `allow`, `agent-governed.ts:176`) lets an agent persist unbounded records with no human in the loop — an unattended write path inconsistent with the discipline everywhere else. Blast radius is domain-contained (only the app's own `os.records` store, only within the caller's domain), so not a cross-tenant breach.

**Remediation:** route agent-initiated record writes through the same `holdDecision`/envelope discipline, or explicitly document records as an always-on domain-contained exception and assert (in a test) that the auto-MCP compiler can never promote record tools to an *external* write.

### M2 — Medium — Promotion release keyed by schema alone: concurrent race + over-broad exemption

**Files:** `os-ui/lib/data/build/live-clients.ts:280-289` (`pushPromoteRelease`/`withdrawPromoteRelease`); `trino.rego:141-145,175-180`.

The one-time release lives at `data.governance.releases[<schema>]` — **one slot per personal schema**. Two concurrent promotions of two datasets owned by the same user target the same key: B overwrites A's `{reader,fqn}`, whichever `finally` runs first `DELETE`s the shared key and drops the other still-running publish's exemption mid-flight (zero rows / denied). The `fqn` field is **not enforced by the rego** (`released_to_reader` checks only `reader == user`), so during the overlap the approver can read *any* table in `personal_<owner>`, not just the promoted one.

**Remediation:** key releases by `<schema>|<fqn>` (or a list) and have `released_to_reader` also match the accessed table against `rel.fqn` (table-scoped exemption). Serialize promotions per source schema or compare-and-set on the release key.

### M3 — Medium — Terminal/Workbench broker secret not profile-gated

**Files:** `charts/.../templates/terminal/terminal.yaml:113`, `charts/.../templates/workbench/workbench.yaml:127`:
```
secret: {{ $t.brokerSecret | default "dev-only-insecure-terminal-secret-change-me" | quote }}
```
Unlike `litellm/credentials.yaml:1` and `polaris.yaml:14` (which gate on `eq .Values.global.profile "local"`), these Secret templates render the insecure default in **any** profile. This token authorizes the only pod holding a Kubernetes credential (the sandbox-Pod broker). Both features default `enabled:false`, but flipping them on without setting `brokerSecret` ships a world-known token → forgeable PTY-broker sessions.

**Remediation:** gate these Secrets on the `local` profile (mirror litellm/polaris), or add a Helm `required`/`fail` when a non-local profile enables the feature with the default still present.

### M4 — Medium (defense-in-depth) — `default allow := true` leaves compiler-missed internal `iceberg.*` tables world-readable

**File:** `charts/sovereign-agentic-os/policies/trino.rego:33` (`default allow := true`) + `:215,220-223`.

The external-catalog fail-closed floor **excludes** internal catalogs (`internal_catalogs := {"iceberg","system"}`) and the domain row filter (`:242-246`) only fires when a `governance.tables` entry exists. So a non-personal `iceberg.<schema>` table for which the policy compiler failed to emit an entry would be readable by any authenticated principal. Personal schemas are safe (separate hard deny); certified/shared marts are safe (compiler always emits, test-proven). This is a compiler-completeness / operator-error gap, not a normal-path leak.

**Remediation:** extend the fail-closed floor to `iceberg` too — any `iceberg.*` table outside `personal_*` with no governance entry should get a `false` row filter, so a compiler miss fails closed.

### M5 — Medium (design tradeoff to state explicitly) — Runtime apps run same-origin in the OS

**File:** `os-ui/lib/software/app-runtime.ts:139` — `<iframe sandbox="allow-scripts allow-same-origin" srcdoc="...">`; served same-origin by `app/api/apps/runtime/[slug]/route.ts:34-45` reusing the ambient `soa_session`.

The generated SPA bundle (LLM-authored, potentially prompt-injected) runs in the **OS origin** with `connect-src 'self'`, so it can make credentialed same-origin `fetch('/api/…')` calls as the user. Unlike the custom-block sandbox (M5's null-origin sibling, which is a real strength), this path's isolation rests **entirely** on the nonce'd CSP (blocking injected `<script>` — but the app's own nonce'd bundle is trusted) and on server-side governance on every `/api/*` call. Net: a malicious/injected shared or marketplace app can act as any user who opens it, within that user's own governance envelope, and is positioned to read the session.

**Remediation:** this is arguably intended ("the app is the user's tool, governed server-side"), but it should be an explicit, documented decision. Harden by: (a) serving runtime apps from a **distinct origin** (subdomain) so app JS cannot share the OS session cookie, or (b) minting a **scoped, short-lived app token** for the app's OS calls instead of reusing the ambient session, and (c) gating marketplace/shared-app adoption on a review/trust signal since opening one runs its code as you.

### L1 — Low — Builder-owner can self-approve their own promotion

**File:** `os-ui/lib/data/store.ts:1444` (request requires `d.owner === user.id`), `:1470-1485` (approve requires builder-in-domain), no `approver.id !== d.owner` check. The guide asserts SoD ("a creator files a request and hands off to a Builder"), but a builder-owner can request then approve their own. Impact bounded (they already hold promote authority), but it contradicts the documented control and the audit trail shows self-approval.

**Remediation:** if SoD is real, add `if (approver.id === d.owner) fail(403)` in `validatePromotion`; else update the guide to stop asserting it.

### L2 — Low — Empty-string `actor.domain` fallback is latent Domain-read widening

**File:** `os-ui/lib/software/app-records.ts:62` — `domain: user.activeDomain ?? (user.domains.length === 1 ? user.domains[0] : '')`. A multi-domain user with no active domain gets `domain:''`. Safe today (`visibleTo` guards the Domain clause with `Boolean(actor.domain)`), but any future record persisted with `domain:''` would be visible to every actor whose `actor.domain` is also `''`.

**Remediation:** make the empty-domain case explicit and fail-closed — restrict `visibleTo` to owner-only when `actor.domain` is falsy, and reject record writes when `app.domain` is empty.

### L3 — Low — Hardcoded dev-default runtime bearer token

**File:** `os-ui/lib/core/config.ts:86` — `agentRuntimeToken: env('AGENT_RUNTIME_TOKEN', 'dev-only-insecure-agent-runtime-token')`, the bearer authorizing the scheduled-run endpoint (`scheduled-run/route.ts:22`). Prod delivers it via External Secrets (the literal renders only for `profile == "local"`, `agent-runtime.yaml:14-19`) and the compare is constant-time, so this is a footgun not a live hole.

**Remediation:** fail closed (throw at boot) when the token is unset on non-local profiles, or make the default an unusable sentinel `runtimeTokenOk` explicitly rejects.

### L4 — Low — Inline Forgejo password placeholder

**File:** `values.dbt-git.yaml:110` — `value: "REPLACE_WITH_FORGEJO_ADMIN_PASSWORD"` as an inline `value:` rather than a `secretKeyRef`. An unreplaced copy-paste deploy authenticates with the literal.

**Remediation:** switch to `valueFrom: { secretKeyRef: { name: forgejo-admin, key: password } }` so an unreplaced deploy fails closed.

### L5 — Low — Marketplace `rls_engine` informational only

**File:** `charts/.../policies/marketplace.rego:51`. `rls_engine := "none"` for known modes; an unrecognized `mode` leaves it undefined while `decision` still returns `allow:true` for an open product. The real RLS is compiled into the engine (per header), so no live enforcement gap — but the decision object shouldn't imply "no RLS" is validated.

**Remediation:** default `rls_engine` explicitly and assert `product_type`/`mode` ∈ a known set.

---

## AuthN / identity (additional detail)

The identity layer is genuinely well-built. Beyond H2 (runtime bearer) and M6 (`resolveMcpUser` misses `disabled`), the notable items:

- **Fail-closed prod boot guard** — `config.ts:673-691` refuses to boot under `NODE_ENV=production` on dev-default session/MCP secrets (correctly keyed on `NODE_ENV`, skips the `next build` phase). Extend it to `AGENT_RUNTIME_TOKEN` (H2).
- **Constant-time comparisons where they matter** — `runtime-auth.ts:19` (`timingSafeEqual` + length guard), `token.ts:87` (MCP HMAC), `oauth.ts:336` (PKCE S256), `users.ts:593` (recovery). Password verify uses a dummy-hash timing equalizer to kill the enumeration oracle (`users.ts:294-300`).
- **R2/R3 delegation is enforced, not advisory** — `data/identity.ts:62-101`: service-account subjects can't delegate, `assertDelegated` re-checks `onBehalfOf === sub`, and the personal lane is hard-bound to the caller's own prefix (`assertOwnSandbox`, `:151`). "View as region" is admin-only server-side (`identity-server.ts:30`).
- **Run-as-owner fails closed** — `scheduled.ts:39-96`: unresolvable/disabled/setup-incomplete owner → null → 409 (never a service principal); autonomy platform gate fails closed; stale write grants re-downgraded against the owner's **live** role.
- **Tokens are identity assertions, not frozen capabilities** — role/domains re-resolved live on every MCP call (`token.ts:105-111`) and every governed-tool call re-hits OPA — so demotion/deletion takes effect immediately.
- **OAuth 2.1 done properly** — mandatory S256 PKCE, single-use 60s codes, strict redirect allowlist that refuses on a bad `redirect_uri`, client-metadata trust bounded to `claude.ai`/`claude.com`, refresh rotation binding client before consuming. One Low: the consent POST has no CSRF token (mitigated by `sameSite:lax` + PKCE + redirect binding — no capturable token results).

**Note:** "Ory/Kratos/Hydra" appears only as documented **future seams** (`session.ts:8-12`, `identity.ts:26`) — there is no live Ory integration yet; the current implementation is a mock-from-session adapter with `verifySession`/`resolveMcpUser`/`delegate` as the designed swap points.

## Injection / untrusted input (additional detail)

Beyond H0 (metric-column SQLi), H3 (ToolWindow same-origin), M5 (runtime-app same-origin), M7 (web-fetch SSRF), M8 (upload buffering), and M9 (`consumes` scope):

**Strengths (verified):**
- **The MCP tool gate is the authoritative injection defense** — `os-ui/lib/mcp/server.ts:819-844` re-checks `roleCanUse(user.role, tool.minRole)` on **every** `tools/call` after the model decides, and each governed function re-checks ownership/OPA. A prompt-injected "delete/promote everything" cannot exceed the caller's grants. This is the correct structural defense (not prompt hygiene) — it is why the prompt-injection items (M9, L6) are Low/Medium, not High.
- **Clean FQN/identifier construction** — `store-fqn.ts` and `transform.ts` build every physical identifier through `sanitizeIdent`/`slug`/`qcol` allowlists; the compiled Silver/Gold CTAS is shape-linted (`assertNoSqlMeta`, `assertFqn`) to pass the write guard. **The metrics path (H0) is the one place that skipped this discipline.**
- **User app code is properly isolated in the custom-block path** — null-origin `sandbox="allow-scripts"` (no `allow-same-origin`) + `default-src 'none'` CSP (`CustomBlockRenderer.tsx`, `sandbox.ts`). Contrast M5/H3 where `allow-same-origin` is present.
- **Egress default-deny + least-privilege** — tinyproxy `FilterDefaultDeny Yes` domain allowlist as the sole internet chokepoint; agent-runtime/Hermes locked to LiteLLM + os-ui `/api/mcp`; web-fetch strips scripts/markup and returns content as DATA.
- **Connections SSRF blocklist** (`secrets.ts:183-245`) hard-blocks metadata IP, loopback, IPv4-mapped-IPv6, link-local, and allowlist-gates RFC1918 / `*.svc.cluster.local`. The gap (M7) is only that **web-fetch doesn't reuse it**.

**Low items:** AppSpec theme CSS via `dangerouslySetInnerHTML` (mitigated by `<`/`>` rejection + selector scoping, `theme.ts:57-58`); no top-level CSP on OS UI routes (L7).

---

## Prioritized remediation order

1. **H0** — IDENT-validate metric `column`/`filter.column`/refs against the gold schema server-side (reuse `qcol`). One-file fix, closes a real injection.
2. **H2** — self-generate the runtime bearer (or add it to the boot guard), enable `serviceBearer`, add a query-tool/data-runner Ingress NetworkPolicy. Config + chart change; closes the in-namespace identity-forgery path on the live deploy.
3. **H1** — validate `req.grants` against the approver's authority before persisting.
4. **H3 / M5** — move embedded tools and runtime apps off the OS origin (or scoped token) so their JS can't act as the user.
5. **M6** — add `u.disabled` to `resolveMcpUser`. One-line, closes the deactivated-user MCP-token gap.
6. **M2, M3, M4, M7, M8, M9** — as detailed above.

_This review is grounded in the code as of 2026-08-22. Findings mark server-enforced vs UI/config-only; the enforcement floors (Trino→OPA, default-deny tool gate, server-derived identity) are genuinely fail-closed — the exposures are in the write/promotion path, the metrics query builder, and the infra/network provisioning defaults._
