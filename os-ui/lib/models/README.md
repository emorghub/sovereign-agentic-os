<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Models

`lib/models/` is the model-context registry and role-resolution layer for the governed LLM
tier. It answers two questions the rest of the platform must never answer from memory:
*"how big is this model's context window?"* and *"which model alias handles this logical
role?"*. Both are driven entirely by configuration — no model name or tier is hardcoded in
application logic.

## Public API

Import via `@/lib/models` (the barrel). Isomorphic — safe from any layer.

**`roles.ts`** — model-role resolution
- `roleDefault(role)`, `roleModel(role)`, `roleModels()`
- `standardFirstEscalationEnabled()`
- `MOCK_MODEL`, `type ModelRole`

**`context-windows.ts`** — context budgets
- `DEFAULT_MODEL_CONTEXTS`, `UNKNOWN_MODEL_CONTEXT`
- `parseOverrides(raw)`, `modelContext(model, overrides?)`, `inputBudget(model, overrides?)`
- `type ModelContext`

Internal (not in the barrel):
- `safetyHeadroom(contextWindow)` — imported by `context-windows.test.ts` only

Documented exception:
- `software/ask-app-origin-route.test.ts:79` intercepts `@/lib/models/roles`
  via `mock.module()`; the deep path is required for the mock to bind.

Both files are unit-tested in `context-windows.test.ts` and `roles.test.ts`.

## Dependencies

- **`lib/core/config`** — for the env-var read helpers used in `roles.ts`.
- No `server-only` guard — both files are pure and may be imported from any layer
  (server, edge, tests). IO-less by design.

## Invariants

- **Models are never hardcoded.** Every reference in `lib/assistant`, `lib/agents`,
  and MCP routes goes through `roleModel(role)` or `inputBudget(modelName)`.
- **Admin override without rebuild.** Setting `MODEL_CONTEXT_WINDOWS` in the Helm
  values overrides context sizes immediately on pod restart; no image rebuild required.
- **Safe unknown-model fallback.** An unrecognised alias gets `UNKNOWN_MODEL_CONTEXT`
  (32 k / 2 k), logging a warning — never a crash or an oversized prompt.
