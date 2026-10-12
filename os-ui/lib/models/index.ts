/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG
 */
/**
 * Models — the module's PUBLIC API.
 *
 * The ONE resolution point for model roles + context budgets. Assistant,
 * Agents, Talk, Knowledge, Software and the API routes import models through
 * THIS module.
 *
 * Isomorphic — no `server-only` here or in the admin settings store it reads,
 * so this barrel is safe from any layer.
 *
 * `safetyHeadroom()` is intentionally NOT re-exported: it is the internal
 * headroom calculation, exposed to context-windows.test.ts by relative import.
 */

// Role resolution: admin override -> connected STACKIT alias -> mock fallback.
export {
  roleDefault,
  roleModel,
  roleModels,
  standardFirstEscalationEnabled,
  MOCK_MODEL,
} from './roles.ts';
export type { ModelRole } from './roles.ts';

// Per-model context window + the input budget callers size prompts against.
export {
  DEFAULT_MODEL_CONTEXTS,
  UNKNOWN_MODEL_CONTEXT,
  parseOverrides,
  modelContext,
  inputBudget,
} from './context-windows.ts';
export type { ModelContext } from './context-windows.ts';
