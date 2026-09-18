/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * Governance — the tab's PUBLIC API.
 *
 * Other tabs, API routes and the MCP import the tab through THIS module.
 * Deep-path imports (e.g. `@/lib/governance/approvals`) remain valid when
 * callers need to avoid symbol collisions between sub-modules.
 *
 * Note: approvals, standing and governance each export `ensureHydrated` /
 * `StandingPolicy`; those surfaces must be imported via their direct paths.
 *
 * This barrel re-exports `server-only` surfaces (approvals.ts, ladder.ts), so
 * the 13 'use client' components that need `canManageArtifact` (edit-scope.ts)
 * or `approvalNotice` (approval-notice.ts) as VALUES keep importing them by
 * deep path. Type-only imports of the same modules are fine through here —
 * types are erased at compile time.
 *
 * `seed.ts` is a demo seeder with one consumer and stays deep-path.
 */

// Cost caps: setCap / addSpend / checkCap / listCaps.
export * from './cost.ts';

// Role + scope helpers: roleRank / principalFor / canSee.
export * from './roles.ts';

// Effect dispatcher for approved promotions.
export * from './effects.ts';

// Audit log: record / search / verifyChain.
export * from './audit.ts';

// Policy plane: egress allowlist, grant overrides, consolidatedPlane.
export * from './policy-view.ts';

// Promotion ladder: promoteThroughSeam / demoteThroughSeam / promoteOrRequest.
export * from './ladder.ts';

// The approval queue (server-only).
// NOTE: `ensureHydrated` is NOT re-exported — collides with standing.ts.
export {
  enqueue, listApprovals, getApproval, decide, recordEffect, __resetApprovals,
} from './approvals.ts';
export type {
  ApprovalKind, ApprovalStatus, ApproverRole, ApprovalScope,
  ApprovalPreview, Approval, ApprovalEffect,
} from './approvals.ts';

// Artifact edit-scope predicate — a re-export shim for lib/core/edit-scope (pure).
export { canManageArtifact } from './edit-scope.ts';
export type { ArtifactScope } from './edit-scope.ts';

// Filed-approval notice (pure).
export {
  POLICIES_PATH, policiesHref, canApproveInline, targetScopeWord, approvalNotice,
} from './approval-notice.ts';
export type { FiledApproval, NoticeUser, ApprovalNotice } from './approval-notice.ts';

// Autonomy presets + write previews.
// NOTE: `StandingPolicy` is NOT re-exported — collides with standing.ts.
export {
  buildPreview, rememberPolicy, matchStandingPolicy, revokeStandingPolicy,
  _clearStandingPolicies, SAFETY_PRESETS, resolveAutonomous,
  setDomainDefaultPreset, setAgentPreset, setAgentToolPreset,
  _clearPresets, effectivePreset,
} from './governance.ts';
export type {
  WritePreview, SafetyPreset, AutonomousEffect, AutonomousDecision,
} from './governance.ts';

// Standing (pre-approved) policies.
// NOTE: neither `ensureHydrated` nor `StandingPolicy` is re-exported — both collide.
export { matchKey, remember, isRemembered, listStanding, __resetStanding } from './standing.ts';

// Role rights configuration.
export {
  COMPONENTS, CAPABILITIES, cellRights, isApplicable, matrixToRights,
  DEFAULT_MATRIX, isValidMatrix, getMatrix, ensureRoleConfigLoaded,
  getMatrixSync, resolveRoleRights, setCapability, __resetRoleConfig,
} from './role-config.ts';
export type { Component, Capability, RoleMatrix } from './role-config.ts';
