<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Infra

`lib/infra` is the **governed spine and the sole gateway to every external
system**. It is the only layer permitted to call OPA, Trino, Cube, OpenSearch,
LiteLLM, MinIO, Forgejo, Kubernetes, the OS-mirror, Secrets Manager, and the
transactional mailer. All data-tool calls and agent tool calls flow through the
two `governed*.ts` spines here — the rest of the codebase may not bypass them.

## Golden path

Every data-tool invocation follows this sequence inside `governed.ts`:

1. **Authorize** — `authorize(user, action, resource)` calls OPA. The call is
   **fail-closed**: any non-200 response or network error denies the request.
2. **Execute** — `cubeLoad()` / `cubeScalar()` / `queryRun()` / `executeRun()`
   hit the appropriate backend (Cube API, query-tool, or Trino directly).
3. **Trace** — `trace()` records the decision, inputs, and outputs to Langfuse.
   Steps 1 and 3 are not optional and cannot be elided by callers.

Agent tool calls follow the same pattern through `agent-governed.ts`, with
additional graph-node context attached to each trace span.

## Public API

Import via `@/lib/infra` (the barrel) for everything EXCEPT the collision and
identity-server surfaces below, which stay deep-path.

**`governed.ts`** — the DATA tool spine (`server-only`)
- Deep-path only (collision with `agent-governed.ts`): `authorize`, `trace`,
  `SALES`, `type ToolName`, `type Authz`
- Via the barrel: `scrubSecurityContext`, `__setCubeMetaForTest`, `cubeMeta`,
  `cubeLoad`, `cubeScalar`, `queryRun`, `executeRun`, `type CubeQuery`,
  `type CubeResult`, `type CubeMetaView`, `type QueryResult`,
  `type ExecuteIdentity`, `type ExecuteResult`

**`agent-governed.ts`** — the AGENT tool spine (`server-only`)
- Deep-path only (same collision): `authorize`, `trace`, `SALES`,
  `type ToolName`, `type Authz`
- Via the barrel: `authorizeAppTool`, `registerConnectionProfile`,
  `unregisterConnectionProfile`, `connectionBundle`, `exposedConnectionTools`,
  `restrictConnectionForAgent`, `authorizeConnectionCall`, `recentTraces`,
  `metricsTool`, `retrieveTool`, `type Effect`, `type Policy`, `type ConnMode`,
  `type ConnToolPolicy`, `type ConnAuthz`, `type TraceEvent`,
  `type TraceRecord`, `type MetricsResult`, `type Passage`,
  `type DlsPrincipal`
- `capability-compiler.ts` is internal to this spine and has no external
  consumer — not re-exported anywhere.

**Via the barrel (no collision)**
- `secrets.ts` (`server-only`) — the only code allowed to hold a raw
  credential value (transiently, never logged): `putSecret`, `hasSecret`,
  `secretFingerprint`, `getSecretServerSide`, `deleteSecret`, `egressHost`,
  `isHardDeniedTarget`, `isInternalTarget`, `isExternal`, `isEgressAllowed`,
  `type SecretRef`
- `os-mirror.ts` (pure) — dual in-process + OpenSearch durable-mirror pattern;
  every tab store calls this to keep the global artifact index consistent:
  `osMirror`, `type OsMirror`
- `app-registry.ts` (`server-only`) — app slug → connection registry:
  `registerConnection`, `registerDurableGrantResolver`, `grantsFor`,
  `grantsForDurable`, `getConnectionByApp`, `setConnectionVisibility`,
  `removeConnection`, `type AppTool`, `type AppConnection`,
  `type DurableGrantResolver`
- `k8s.ts` (pure) — Kubernetes API client scoped to the platform namespace:
  `k8s`, `k8sText`, `type K8sResult`, `type K8sTextResult`
- `service-bearer.ts` (`server-only`) — inter-service bearer header:
  `serviceBearerHeader`
- `tool-proxy.ts` (`server-only`) — reverse proxy for embedded console tools
  (Superset, OpenSearch Dashboards): `TOOLS`, `resolveTool`, `roleAllowed`,
  `rewriteCsp`, `rewriteLocation`, `rewriteSetCookie`,
  `transformResponseHeaders`, `buildUpstreamHeaders`, `proxy`, + its types
- `tool-sso-langfuse.ts` (`server-only`) — short-lived Langfuse SSO session:
  `hasLangfuseSession`, `cookiePair`, `loginLangfuse`,
  `_resetLangfuseSessionCache`, `getLangfuseSessionCookies`,
  `type LangfuseLoginOpts`
- `mailer.ts` (`server-only`) — pluggable transactional mailer: prefers
  Microsoft Graph, falls back to SMTP, no-ops when neither is configured:
  `__setMailTransportForTests`, `__resetGraphTokenCacheForTests`,
  `graphConfig`, `smtpConfig`, `selectMailer`, `mailerConfigured`,
  `emailVerificationEnabled`, `senderAddress`, `sendVerificationEmail`,
  `sendNotificationEmail`, + its types
- `forgejo.ts` (pure, type-only) — `type ForgejoCommit`,
  `type ForgejoCommitFiles`, `type ForgejoClient`
- `context/context-assembler.ts` (pure) — candidate scoring + context
  assembly: `estimateTokens` (itself a re-export from
  `@/lib/knowledge/context-pack`), `deterministicScore`, `compactToolResult`,
  `assembleContext`, `truncateToTokens`, + its types
- `context/librarian.ts` (pure) — the governed curation layer on top of the
  assembler: `curateContext`, `curateThenAssemble`, + its types
- `context/librarian-live.ts` (`server-only`) — the live embedding-backed
  curator: `liveEmbedder`, `guardedEmbedder`, `type LiveEmbedder`

**Deep-path only (not re-exported at all)**
- `identity-server.ts` (`server-only`) — `delegatedToken`. Its only value
  export imports `requireUser` from `@/lib/core/auth`, which imports
  `next/headers` (a live Next.js request API). Re-exporting it here would make
  importing ANY other barrel surface transitively load `next/headers`,
  breaking every plain-Node test that doesn't already mock `@/lib/core/auth`.
  Its 6 consumers stay on `@/lib/infra/identity-server`.

### Documented exceptions (deep-path, intentional)

- `lib/infra/governed.ts:6` and `lib/infra/agent-governed.ts:6-13`
  self-import `./service-bearer.ts` / `./app-registry.ts` +
  `./capability-compiler.ts` by relative path, not the barrel, to avoid a
  circular import.
- `lib/assistant/agentic.ts` and `lib/assistant/budget-messages.test.ts` —
  `agentic.ts`'s own README states "no imports from `lib/infra`" as an
  explicit purity contract (it is unit-tested standalone, IO-injected, no
  `server-only`); its test keeps the same deep path to `context-assembler.ts`
  to avoid pulling `governed.ts`/`secrets.ts`/`mailer.ts` into what should be
  a fast, isolated unit test.
- `lib/agents/build/live-clients.ts` — deep path to `agent-governed.ts` for
  `recentTraces`. It is statically imported (via `instrumentation.ts`, a
  Next.js file bundled for BOTH the Node and Edge runtimes) into a build
  target that cannot resolve `node:crypto` / `node:fs` / `node:https` /
  `node:net` — the barrel's `secrets.ts`/`k8s.ts`/`mailer.ts` pull those in.
  `next build` is the gate that catches this; `tsc` does not.
- Lazy `await import()` calls stay on their deep path — the barrel would
  eagerly load the whole module tree, defeating the lazy load:
  `lib/science/deploy.ts:113`, `lib/science/training.ts:232`,
  `lib/software/build-service.ts:281` (`@/lib/infra/k8s`),
  `lib/science/model-service.ts:730` (`@/lib/infra/agent-governed`), and three
  test-isolation dynamic imports of `@/lib/infra/secrets`
  (`lib/connections/cloud-keyservices-store.test.ts`,
  `lib/connections/connector-wave-store.test.ts`,
  `lib/connections/rotate-credential.test.ts`).
- Seven `mock.module()` test interceptors target internal files directly, not
  the barrel, and must supply EVERY named export of the file they target
  (`governed.ts` has 10, `agent-governed.ts` has 13, `k8s.ts` has 2), because
  the barrel re-exports the full surface:
  - `lib/data/build/live-clients.test.ts` → `@/lib/infra/governed`
  - `lib/science/launch-grounding.test.ts` → `@/lib/infra/k8s`
  - `lib/science/assistant-grounding.test.ts` → `@/lib/infra/governed`
  - `lib/metrics/build/explore-presave.test.ts` → `@/lib/infra/governed`
  - `lib/metrics/build/live-clients.test.ts` → `@/lib/infra/governed`
  - `lib/software/ask-app-origin-route.test.ts` → `@/lib/infra/governed`
  - `lib/software/app-tool-call.test.ts` → `@/lib/infra/agent-governed`

Test coverage: `governed-failclosed.test.ts`, `governed-execute.test.ts`, and
`governed-rls-scrub.test.ts` are the policy-correctness regression suite; they
must pass on every PR that touches `governed.ts`.

## Invariants

- **OPA is fail-closed.** A timeout, network error, or unexpected status from OPA
  is treated as a denial — never as a grant.
- **Secrets are transient.** `secrets.ts` returns raw values only to the calling
  frame; callers must not store them in logs, traces, or database records.
- **One spine per call type.** Data calls go through `governed.ts`; agent calls
  go through `agent-governed.ts`. Bypassing either breaks the audit trail.
- **Mirror writes are synchronous.** Every artifact mutation writes to the
  OS-mirror before returning `200` — the mirror is not eventually consistent.

## Dependencies

| Imports from | — |
|---|---|
| Internal `lib/` | `lib/core` only |
| External | OPA, Cube, Trino, OpenSearch, LiteLLM, MinIO, Forgejo, k8s API |

`lib/core` must **not** import `lib/infra`. Tab stores import `lib/infra` and
`lib/core`; they do not call external services directly.
