/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * Infra — the module's PUBLIC API.
 *
 * Every tab, API route and MCP tool reaches an external system through THIS
 * module: Cube, Trino, OPA, Langfuse, Kubernetes, OpenSearch, the K8s secret
 * store and the OS mirror. Most surfaces are `server-only`; there are no client
 * consumers today, so the whole module is re-exported here.
 *
 * NOT re-exported — `governed.ts` (the DATA spine) and `agent-governed.ts` (the
 * AGENT spine) both export `authorize`, `trace`, `SALES`, `ToolName` and `Authz`
 * with DIFFERENT shapes: data authz is allow/deny, agent authz is
 * allow/deny/requires_approval. Callers of any of those five import the spine
 * they mean by deep path (`@/lib/infra/governed` or `@/lib/infra/agent-governed`),
 * as they do today. Everything else in both spines is available here.
 *
 * `capability-compiler.ts` is internal to `agent-governed.ts` and has no
 * external consumer; it is not re-exported.
 *
 * `identity-server.ts` is NOT re-exported either — its only value export
 * (`delegatedToken`) imports `requireUser` from `@/lib/core/auth`, which
 * imports `next/headers` (a live Next.js request API, not resolvable outside
 * the Next.js runtime). Bundling it into this barrel would make importing
 * ANY other export here — `queryRun`, `osMirror`, anything — transitively
 * load `next/headers`, breaking every plain-Node test that doesn't already
 * mock `@/lib/core/auth`. Its 6 consumers stay deep-path
 * (`@/lib/infra/identity-server`).
 */

// ---- Data-tool spine: Cube + Trino + query-tool (server-only) ----
// authorize / trace / SALES / ToolName / Authz -> deep-path only (collision).
export {
  scrubSecurityContext,
  __setCubeMetaForTest,
  cubeMeta,
  cubeLoad,
  cubeScalar,
  queryRun,
  executeRun,
} from './governed.ts';
export type {
  CubeQuery, CubeResult, CubeMetaView,
  QueryResult, ExecuteIdentity, ExecuteResult,
} from './governed.ts';

// ---- Agent-tool spine: OPA + Langfuse + connection profiles (server-only) ----
// authorize / trace / SALES / ToolName / Authz -> deep-path only (collision).
export {
  authorizeAppTool,
  registerConnectionProfile,
  unregisterConnectionProfile,
  connectionBundle,
  exposedConnectionTools,
  restrictConnectionForAgent,
  authorizeConnectionCall,
  recentTraces,
  metricsTool,
  retrieveTool,
} from './agent-governed.ts';
export type {
  Effect, Policy, ConnMode, ConnToolPolicy, ConnAuthz,
  TraceEvent, TraceRecord, MetricsResult, Passage, DlsPrincipal,
} from './agent-governed.ts';

// ---- K8s secret store — the only code holding a raw credential (server-only) ----
export {
  putSecret, hasSecret, secretFingerprint, getSecretServerSide, deleteSecret,
  egressHost, isHardDeniedTarget, isInternalTarget, isExternal, isEgressAllowed,
} from './secrets.ts';
export type { SecretRef } from './secrets.ts';

// ---- Durable in-process + OpenSearch mirror (pure) ----
export { osMirror } from './os-mirror.ts';
export type { OsMirror } from './os-mirror.ts';

// ---- App slug -> connection registry (server-only) ----
export {
  registerConnection, registerDurableGrantResolver, grantsFor, grantsForDurable,
  getConnectionByApp, setConnectionVisibility, removeConnection,
} from './app-registry.ts';
export type { AppTool, AppConnection, DurableGrantResolver } from './app-registry.ts';

// ---- Kubernetes API client (pure) ----
export { k8s, k8sText } from './k8s.ts';
export type { K8sResult, K8sTextResult } from './k8s.ts';

// ---- Inter-service bearer header (server-only) ----
export { serviceBearerHeader } from './service-bearer.ts';

// ---- Embedded console tool proxy (server-only) ----
export {
  TOOLS, resolveTool, roleAllowed, rewriteCsp, rewriteLocation, rewriteSetCookie,
  transformResponseHeaders, buildUpstreamHeaders, proxy,
} from './tool-proxy.ts';
export type { Protocol, SsoMode, ToolSso, Tool, Principal, SessionSso } from './tool-proxy.ts';

// ---- Langfuse SSO session (server-only) ----
export {
  hasLangfuseSession, cookiePair, loginLangfuse,
  _resetLangfuseSessionCache, getLangfuseSessionCookies,
} from './tool-sso-langfuse.ts';
export type { LangfuseLoginOpts } from './tool-sso-langfuse.ts';

// ---- Transactional mailer: Graph -> SMTP -> no-op (server-only) ----
export {
  __setMailTransportForTests, __resetGraphTokenCacheForTests,
  graphConfig, smtpConfig, selectMailer, mailerConfigured,
  emailVerificationEnabled, senderAddress,
  sendVerificationEmail, sendNotificationEmail,
} from './mailer.ts';
export type { GraphConfig, SmtpConfig, OutgoingMail, MailerKind } from './mailer.ts';

// ---- Forgejo client types (pure) ----
export type { ForgejoCommit, ForgejoCommitFiles, ForgejoClient } from './forgejo.ts';

// ---- Context assembly + the governed librarian ----
// context-assembler.ts and librarian.ts are pure; librarian-live.ts is server-only.
// `estimateTokens` is itself a re-export from @/lib/knowledge/context-pack.
export {
  estimateTokens,
  deterministicScore,
  compactToolResult,
  assembleContext,
  truncateToTokens,
} from './context/context-assembler.ts';
export type {
  CandidateKind, Candidate, AssembledContext, ScoreCandidate,
  AssembleInput, CompactionOptions,
} from './context/context-assembler.ts';

export { curateContext, curateThenAssemble } from './context/librarian.ts';
export type {
  EmbedFn, CurateCandidate, CurationTraceEntry, CurationResult,
  CurateInput, CurateThresholds, EscalateSelection, EscalateFn,
  CurateThenAssembleInput, CurateThenAssembleResult,
} from './context/librarian.ts';

export { liveEmbedder, guardedEmbedder } from './context/librarian-live.ts';
export type { LiveEmbedder } from './context/librarian-live.ts';
