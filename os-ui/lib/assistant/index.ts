/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * Assistant — the module's PUBLIC API.
 *
 * Every tab assistant, stage assistant, agent graph and API route reaches the
 * governed LLM path through THIS module, never through its internal files.
 *
 * Five of the surfaces below are `server-only` (complete, runtime, escalate,
 * stage-route, agent-loop); agentic, json-reply, turns and page-context are
 * pure. There are no client consumers today, so the whole module is
 * re-exported here. A future 'use client' component needing the pure surfaces
 * must import them by deep path.
 *
 * `lib/software/appspec/generate-server.ts` and `generate.ts` import this
 * barrel's deep paths (`@/lib/assistant/complete`, `@/lib/assistant/json-reply`),
 * NOT this barrel, on purpose: they sit on
 * `lib/mcp/server.ts -> platform-mcp.ts -> appspec/generate-server.ts`, and
 * `runtime.ts`/`agent-loop.ts` (re-exported here) import `lib/mcp/server.ts`
 * back — going through the barrel from either of those two files closes that
 * cycle (a `ReferenceError: Cannot access '...' before initialization` at
 * module-init time). Keep them deep-path.
 */

// Governed completion + its typed failures (server-only).
export {
  AssistantNotConfiguredError,
  CostCapExceededError,
  resolveAssistantModelId,
  liteLlmAssistantCaller,
  assistantComplete,
} from './complete.ts';
export type { AssistantMessage, AssistantRequest, AssistantCaller } from './complete.ts';

// Standard-first escalation to the reasoning tier (server-only).
export { completeWithEscalation } from './escalate.ts';
export type { EscalationResult, EscalationOpts } from './escalate.ts';

// The tab-assistant runtime — the entry point for route handlers (server-only).
export {
  tabToolSpecs,
  tabToolExecutor,
  bindToolArgs,
  boundExecutor,
  liteLlmCaller,
  parseLlmUsage,
  stripHarmonyTokens,
  parseHarmonyToolCall,
  parseLlmMessage,
  runTabAgent,
  renderAssistantText,
} from './runtime.ts';
export type { RunTabAgentInput } from './runtime.ts';

// The SSE-streaming OS assistant loop (server-only).
export {
  mcpTabForPath,
  osAssistantSystem,
  osToolSpecs,
  osToolExecutor,
  runOsAssistant,
} from './agent-loop.ts';
export type { RunOsAssistantInput, OsAssistantResult } from './agent-loop.ts';

// Stage-assistant helper + its uniform failure response (server-only).
export { failResponse, parseStageJson, runStageAssistant } from './stage-route.ts';
export type { StagePrompt, StageUser, StageAssistantOptions } from './stage-route.ts';

// The pure PLAN -> ACT agentic loop.
export {
  trackUsage,
  ToolCallingUnsupportedError,
  toolCallSignature,
  toOpenAiTools,
  parseReactAction,
  budgetMessages,
  runAgentic,
} from './agentic.ts';
export type {
  ChatRole, LlmMessage, ToolSpec, OpenAiTool, ToolCall, LlmUsage,
  LlmCompletion, LlmRequest, LlmCall, UsageTracker, ToolExecutor,
  AgenticStep, AgenticResult,
} from './agentic.ts';

// JSON reply parsing for structured assistant answers (pure).
export { extractJsonObject, extractJsonArray, parseJsonReply, parseJsonArrayReply } from './json-reply.ts';

// Conversation turn normalisation (pure).
export { cleanTurns } from './turns.ts';
export type { ConversationTurn } from './turns.ts';

// Page-context sanitiser for the Ask-the-OS box (pure).
export { sanitizePageContext, renderPageContext } from './page-context.ts';
export type { PageContextInput, PageContext } from './page-context.ts';
