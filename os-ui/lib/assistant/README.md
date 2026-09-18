<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Assistant

`lib/assistant` is the **agentic assistant harness** — the two-tier PLAN→ACT loop
that powers every in-app helper and the Software build chat. The core loop
(`agentic.ts`) is pure and IO-injected for testability; `runtime.ts` wires it to
the OS system prompt, per-tab CONTEXT.md files, role-scoped MCP tool schemas, and
the governed executor — the same `handleRpc` path the MCP route uses, with no
privileged shortcut.

## Golden path

A tab assistant call follows this sequence:

1. **Route** — `app/api/assistant/[tab]/route.ts` (or the software build route)
   calls `runTabAssistant(req)` from `runtime.ts`.
2. **Compose context** — `runtime.ts` assembles: OS-rules system prompt + tab's
   `CONTEXT.md` + the caller's role-scoped MCP tool schemas.
3. **PLAN** — `runAgentic` sends the assembled context to the reasoning model
   (`resolveAssistantModelId('plan')`). The plan enumerates tool calls and
   expected outcomes.
4. **ACT** — The execution model (`resolveAssistantModelId('act')`) works through
   the plan, calling `governed executor → handleRpc` for each tool invocation.
   OPA-authorization and Langfuse tracing apply exactly as in the MCP route.
5. **Repeat** — steps 3–4 iterate up to `assistantMaxSteps` rounds; the loop
   breaks early on a final answer or on a hard stop signal.
6. **Stream** — `agent-loop.ts` wraps the loop output in SSE events consumed by
   the tab's `<AssistantPanel>`.

## Public API

Import via `@/lib/assistant` (the barrel). There are no client consumers today,
so the whole module — server-only surfaces included — is re-exported.

**`server-only`**
- `complete.ts` — governed completion + its typed failures: `assistantComplete`,
  `resolveAssistantModelId`, `liteLlmAssistantCaller`,
  `AssistantNotConfiguredError` (503), `CostCapExceededError` (402),
  `type AssistantMessage`, `type AssistantRequest`, `type AssistantCaller`
- `escalate.ts` — `completeWithEscalation`, `type EscalationResult`,
  `type EscalationOpts`
- `runtime.ts` — the tab-assistant runtime: `tabToolSpecs`, `tabToolExecutor`,
  `bindToolArgs`, `boundExecutor`, `liteLlmCaller`, `parseLlmUsage`,
  `stripHarmonyTokens`, `parseHarmonyToolCall`, `parseLlmMessage`, `runTabAgent`,
  `renderAssistantText`, `type RunTabAgentInput`
- `agent-loop.ts` — the SSE-streaming OS assistant loop: `mcpTabForPath`,
  `osAssistantSystem`, `osToolSpecs`, `osToolExecutor`, `runOsAssistant`,
  `type RunOsAssistantInput`, `type OsAssistantResult`
- `stage-route.ts` — shared scaffolding for the per-STAGE tab assistants (see
  "Per-stage tab assistants" below): `failResponse`, `parseStageJson`,
  `runStageAssistant`, `type StagePrompt`, `type StageUser`,
  `type StageAssistantOptions`

**Pure**
- `agentic.ts` — the PLAN→ACT loop: `runAgentic(opts)`, `trackUsage`,
  `ToolCallingUnsupportedError`, `toolCallSignature`, `toOpenAiTools`,
  `parseReactAction`, `budgetMessages`, + its full type surface (`ChatRole`,
  `LlmMessage`, `ToolSpec`, `OpenAiTool`, `ToolCall`, `LlmUsage`,
  `LlmCompletion`, `LlmRequest`, `LlmCall`, `UsageTracker`, `ToolExecutor`,
  `AgenticStep`, `AgenticResult`). IO is injected via `opts.planModel` /
  `opts.actModel` / `opts.executor` so the loop is fully unit-testable without
  network calls.
- `json-reply.ts` — `extractJsonObject`, `extractJsonArray`, `parseJsonReply`,
  `parseJsonArrayReply`
- `turns.ts` — `cleanTurns`, `type ConversationTurn`
- `page-context.ts` — `sanitizePageContext`, `renderPageContext`,
  `type PageContextInput`, `type PageContext` — sanitiser for the Ask-the-OS box

### Documented exceptions (deep-path, intentional)

- `lib/assistant/stage-route.ts:6-8` — self-imports `./complete.ts`,
  `./escalate.ts`, `./json-reply.ts` by relative path, not the barrel, to avoid
  a circular import.
- `lib/software/appspec/generate-server.ts` and `generate.ts` — deep-path
  (`@/lib/assistant/complete`, `@/lib/assistant/json-reply`) for the same
  reason. Both sit on `lib/mcp/server.ts -> platform-mcp.ts ->
  appspec/generate-server.ts`, and `runtime.ts`/`agent-loop.ts` (re-exported by
  the barrel) import `lib/mcp/server.ts` back; going through the barrel here
  closes that cycle and throws a TDZ `ReferenceError` at module-init time.
- Four `mock.module()` test interceptors target internal files directly, not
  the barrel:
  - `lib/connections/expose-assistant-route.test.ts` → `@/lib/assistant/complete`
  - `lib/software/data-plan-server.test.ts` → `@/lib/assistant/complete`
  - `lib/software/ask-app-origin-route.test.ts` → `@/lib/assistant/runtime`
  - `app/api/agents/systems/[id]/assistant/route.test.ts` → `@/lib/assistant/complete`

  The four `mock.module()` interceptors must supply EVERY named export of the
  file they target, because the barrel re-exports the full surface.

Test suite: `agentic.test.ts` (loop logic), `runtime.test.ts` (context assembly
and executor binding), `budget-messages.test.ts` (context-window budgeting and
truncation behaviour).

## Per-stage tab assistants (`stage-route.ts`)

Five build tabs (Data · Metrics · Dashboards · Science · Software) each ship a
per-STAGE helper: `app/api/<tab>/…/assistant/route.ts` on the server plus a
`StageAssistant` slot component mounted in `StageShell`'s `assistant` render
prop. They are NOT the agentic PLAN→ACT loop — they run ONE `assistantComplete`
turn that only SUGGESTS (never mutates); the client applies suggestions through
the normal governed paths.

Every route once copied the same mechanical tail — a `fail(e)` status mapper, the
`assistantComplete([system,user])` call, and a defensive JSON-fence strip/parse.
`stage-route.ts` lifts exactly that:

- Each route keeps its **stage set, prompt table (`promptFor`), and JSON key**
  local (they genuinely differ), then calls `runStageAssistant({ prompt, user,
  jsonKey?, expectArray?, jsonError? })` and hands thrown errors to
  `failResponse`.
- A prose stage (`prompt.json === false`) returns `{ text }`; a JSON stage
  fence-strips + `JSON.parse`s the reply, guards the shape (`expectArray` for an
  array, else a plain object), and returns `{ [jsonKey]: parsed }` — or a 502
  with `jsonError` on an unusable shape.
- Honest failures pass straight through: `assistantComplete` throws
  `AssistantNotConfiguredError` (503) and `CostCapExceededError` (402), which
  `failResponse` maps to their own status. There is NO fake-AI fallback.

The **client `StageAssistant` slots are deliberately NOT shared.** They wear an
identical `passthrough-note` card and busy/error/text state, but each binds a
bespoke response-key callback (`onDraft` / `onForm` / `onCharts` / `onDefinition`)
with its own applied-suggestion confirmation copy. Lifting a generic shell would
force a common callback contract onto five call sites for little gain — the
duplication is cosmetic, so it stays local by design.

## Invariants

- **No privileged tool path.** The governed executor calls `handleRpc`, the
  identical function used by the MCP route. OPA, tracing, and RLS apply to every
  assistant tool call — no exceptions.
- **Models are configurable.** `resolveAssistantModelId` reads from the admin
  model table. Hard-coding a model name here is a policy violation.
- **Loop is pure.** `agentic.ts` has no imports from `lib/infra` or `lib/tabs`;
  all IO arrives through injected options. Tests must not require a running
  backend.
- **Step cap is enforced.** The loop exits after `assistantMaxSteps` plan→act
  cycles regardless of tool results, preventing unbounded inference spend.

## Dependencies

| Imports from | — |
|---|---|
| Internal `lib/` | `lib/core`, `lib/infra`, `lib/mcp`, `lib/tabs`, `lib/models` |
| Entry point callers | `app/api/assistant/*/route.ts`, software build route |

`lib/assistant` is a leaf consumer — nothing in `lib/core` or `lib/infra`
imports it.
