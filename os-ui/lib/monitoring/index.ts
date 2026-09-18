/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * Monitoring — the read/observe plane. Barrel for the OPA-scoped aggregation +
 * trace/lineage correlation spine and its read-only adapters. See
 * `lib/monitoring/README.md` for the architecture + the validation gate.
 *
 * NOT re-exported: `mock.ts` is test fixture data with a single consumer
 * (`lib/mcp/monitoring-tools.test.ts`); it stays deep-path.
 *
 * `scope.ts` (server-only) itself re-exports `scope-core.ts`'s pure predicates,
 * so canSee / filterScope / assertInScope / deriveScope are surfaced ONCE, via
 * `./scope` — never from both files.
 */
export * from './types';
export { buildOverview, collectAll } from './aggregate';
export { correlate } from './correlate';
export { scopeForUser, canSee, filterScope, assertInScope, deriveScope } from './scope';

// Per-artifact detail views (server-only).
export { agentDetail, datasetDetail } from './detail-view.ts';
export type { AgentDetail, DatasetCheckRow, DatasetDetail } from './detail-view.ts';

// Data-quality overview (pure).
export { riskScore, buildDqOverview } from './dq-overview.ts';
export type { DqDatasetInput, DqRiskRow, DqOverview } from './dq-overview.ts';

// Artifact monitoring view (server-only).
export { artifactMonitoring } from './artifacts-view.ts';
export type {
  AgentTile, DataHealthRow, AgentScopeGroups, DataScopeGroups, ArtifactMonitoring,
} from './artifacts-view.ts';

// LLM gateway usage shaping (pure).
export { SPEND_WINDOW_MS, shapeActivity, weeklyRunSpend } from './gateway-usage.ts';
export type { RawActivity, Activity, WeeklySpend, GatewayUsage } from './gateway-usage.ts';

// Read-only adapter collectors (server-only).
export { collectCost, litellmSpendByTag } from './adapters/cost.ts';
export { collectRuns, fetchTrace } from './adapters/run-trace.ts';
export { collectSystem } from './adapters/system-health.ts';
export { tenantRuns, agentTelemetryBatch, agentTelemetryFor } from './adapters/agent-telemetry.ts';
export type { AgentRunRecord, AgentTelemetryResult } from './adapters/agent-telemetry.ts';
