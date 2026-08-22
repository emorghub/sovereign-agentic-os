<!-- SPDX-License-Identifier: Apache-2.0 — Copyright 2026 Borek Data Ventures UG -->
# Design Review 2026 — More Magic, More Simplicity

**Sovereign Agentic OS · `os-ui` (v0.2.0-alpha.11) · read-only design review**
**Author:** Product design + AI architecture review · 2026-08-22

> Sensibility applied throughout: Apple — beautiful, simple, smooth; complexity hidden
> behind elegant surfaces; **one clear thing per screen**. No default Inter, no purple
> gradients, no centered-hero clichés, no cards-in-cards. Every proposal below names the
> **real** component, route, or lib it builds on.

---

## Executive summary

The OS is architecturally ahead of its surface. Underneath the tabs there is already:
a **staged-builder primitive** (`StageShell`) worn by every tab; a **shared lifecycle
cluster** (`LifecycleActions`); a **governed context-grants shell** (`ChooseContextShell`);
a real, wired **Context Librarian** that curates per-request context under DLS/OPA
(`lib/infra/context/librarian.ts`, live in `agentic-graph.ts` and `talk.ts`); and — the
crown jewel — a **Big Bet planner** (`lib/bigbets/planner.ts`) that already turns a *goal*
into a *dated, dependency-ordered, multi-tab plan* and scaffolds it through each tab's
governed create flow as a `kind:'planner'` actor that **can build but never ship**.

The gap is not capability. It is **coherence and courage**:

1. **The surfaces are over-buttoned and inconsistently governed.** A single dataset header
   can show Back · Simple/Developer · Rename · tier badge · View/Edit · Promote/Certify ·
   Request-cert · Demote · Archive · Version history — up to **10 competing controls**.
   Three different promote mechanisms exist across tabs (`promoteBlock` inline in Data,
   the shared `PromoteButton` in Metrics/Dashboards, a bare `post('promote')` in Agents).
2. **The assistant mostly *chats*; it rarely *does*.** `StageAssistantChat` proposes
   beautiful suggestion cards — but only Agents/Software/Science mount it. Data, Metrics,
   Dashboards, Knowledge, Connections, Files have **no in-builder assistant**, only a
   tab-level `TalkTo`. And the front-door `AskAssistant` (`/api/home/ask`) can scaffold
   exactly **one** Personal draft — it cannot orchestrate the "I need context + an agent +
   a dashboard" intent that the Big Bet planner already knows how to plan.
3. **The best context substrate in the building is under-exploited.** The Librarian is a
   budget-aware *curator* over an already-DLS-filtered pool; it is not yet the *agentic
   librarian* the 2026 literature describes (hybrid lexical+semantic+graph retrieval,
   re-ranking, memory, just-in-time assembly). The `escalate` seam is designed but unwired.

This document proposes four moves — **fewer buttons**; an **assistant-first default** where
you *talk to build the artifact* and the full staged builder hides behind an **Expert Mode**
toggle; a **proactive assistant + a "what do you want to build today?" start screen** that
orchestrates via the Big Bet planner; and a **2026-grade Context Librarian** — each grounded
in code that already exists, each shippable in slices, none requiring a parallel stack. The
unifying idea: **invert the default** so the calm conversation is the front page and the
complexity (stages, canvas, config) is one deliberate tap away.

**Top recommendations (detail + effort/impact in the roadmap at the end):**

1. Adopt a **control budget: one primary + one lifecycle menu + one mode toggle** per screen; fold Archive/Delete/Versions/Demote into a single `⋯ Manage` menu inside `LifecycleActions`. *(S, high)*
2. **Unify promotion** on one `<PromoteButton>` used by *every* tab (retire Data's inline `promoteBlock` and Agents' `post('promote')`). *(M, high)*
3. **Assistant-first by default (§2b):** make one conversational `StageAssistantChat` the primary surface for building each tab's artifact; reveal the full staged builder behind an **`Assistant · Expert`** toggle — the existing Simple/Developer control, generalized OS-wide. Pilot on Metrics + Dashboards, then roll OS-wide. *(M pilot → L rollout, very high)*
4. Make the assistant **proactive by default** — extend the already-built `autoFirePrompt` in `StageAssistantChat` so it proposes on entry, not on demand (this becomes the content of the assistant-first surface). *(M, high)*
5. Ship the **"What do you want to build or do today?"** start screen as the new front door, routing single-artifact intents into the owning tab **opened assistant-first with the intent seeded as turn one**, and **multi-artifact intents into a Big Bet** via `proposePlan`. *(L, very high)*
6. Give every proactive/orchestrated action a **Plan → Preview → Confirm → Execute** ceremony with per-step OPA/DLS gates and a human confirm on any outward/destructive step (reuse `approvePlan`'s `kind:'planner'` invariant). *(M, high)*
7. Turn the Librarian into an **agentic librarian**: add hybrid retrieval (OpenSearch BM25 + embeddings fused with RRF) + a re-rank stage in front of `curateContext`, wire the `escalate` LLM-curator seam. *(L, high)*
8. Add **governed agent memory** (episodic/semantic/procedural) as a first-class grantable context type in `ChooseContextShell`, curated by the librarian and DLS-scoped. *(L, high)*
9. Make **honest degradation visible and consistent** — the Librarian's `mode:offline-mock`/`fallback` and the planner's `sourceMode()` should surface as one calm "running offline / degraded" chip, never a silent fabrication. *(S, medium)*

---

# 1 · Fewer, clearer buttons

## 1.1 The problem, measured

The OS already *has* the right shared primitives — the issue is that too many of them
render at once, and a few tabs bypass the shared ones with bespoke variants.

**Worst offender — the Data builder header** (`components/data/DataBuilder.tsx`, header
~L1030–1154). On one row a returning user can face:

`← Datasets` · `Simple｜Developer` (`BuilderModeToggle`) · `✎ Rename` · tier badge ·
`✎ Edit dataset｜‹ View` · **`Promote to Domain →`** *(or)* **`Certify to Company →`**
*(or)* **`Request certification →`** · `Demote to My` (`DemoteButton`) · `Archive` ·
`Version history` (`LifecycleActions`).

That is up to **ten controls**, three of them competing for "primary" (`btn` filled
style): Promote, Certify, Request-cert. Then *inside* Edit, individual sections pile on:
the **Checks** section alone exposes `Add a custom check` · `Run all checks` · `Accept all`
· per-rule `Delete` · inline description edit · `Save Data Quality Checks` — **7 actions,
no clear primary** until a rule is half-filled.

**Inconsistency across tabs** (verified):

| Concern | Data | Metrics / Dashboards | Agents | Big Bets |
|---|---|---|---|---|
| Promote/certify | inline `promoteBlock()` | shared `<PromoteButton>` | bare `post('promote')` button | `Edit bet` full form |
| Demote | `<DemoteButton>` | `<DemoteButton>` | inline confirm-then-`post('demote')` | n/a |
| Lifecycle | `<LifecycleActions>` | `<LifecycleActions>` | `<LifecycleActions>` | `<LifecycleActions>` |
| View/Edit | header toggle | header toggle | *two* toggles: Simple/Developer **and** View/Edit | no toggle (form overlay) |
| Builder mode | Simple/Developer | Simple/Developer | Simple/Developer | n/a |

So the OS has **three promotion code-paths, three View/Edit conventions, and one tab
(Agents) with two mode toggles side by side** (Simple/Developer *and* View/Edit — see
`SystemView.tsx` L393–438). This is the clutter tax: the same governed act looks and
behaves differently depending on where you are.

## 1.2 The control-budget principle

> **One screen, one primary action.** Everything else is (a) a single View/Edit switch,
> (b) a single lifecycle overflow menu, or (c) folded into the assistant. If a control is
> used by fewer than ~1 in 20 sessions, it does not earn header space — it lives one calm
> click deeper.

Concretely, a builder detail header gets a **budget of three regions**:

1. **Left — orientation:** `← Back` + name (+ inline rename on click) + tier badge. No mode
   toggles here.
2. **Center — nothing.** (Apple: the content is the hero, not the chrome.)
3. **Right — exactly two things:** the **primary lifecycle act** for the current tier
   (Promote *or* Certify *or* Publish — never two at once), and a single **`⋯ Manage`**
   menu.

`Simple｜Developer` and `View｜Edit` collapse into **one segmented control** with three
states where they truly differ (see 1.4), or move into `⋯ Manage` where they don't.

## 1.3 Per-tab before → after

**Data (`DataBuilder.tsx`)**
- *Keep:* `← Datasets`, name+rename, tier badge, the single tier-correct primary
  (`Promote to Domain →` / `Certify to Company →`), View/Edit.
- *Merge:* `Request certification →` is **the same act** as Certify for a non-admin —
  render one button whose label + handler switch on role, not two buttons.
- *Move behind `⋯ Manage`:* `Demote`, `Archive`, `Delete`, `Version history`,
  `Simple/Developer`.
- *Fold into the assistant:* the **Checks** section's `Add a custom check` + `Accept all`
  becomes "the assistant proposes checks from the profile; you Apply" — reuse the exact
  `SuggestionCard`/`onApply` mechanism already in `StageAssistantChat`. `Save` stays; the
  6 competing verbs collapse to *Apply suggestions* + *Save*.
- **Result:** header drops from ~10 controls to **4** (Back · name · primary · ⋯).

**Agents (`SystemView.tsx`)**
- *Kill the double toggle.* Simple/Developer and View/Edit are two axes stacked in the
  header. Collapse to **one** control: `View · Edit · Advanced` (Advanced == today's
  Developer canvas/Monaco). "Simple" is just Edit; "Developer" is Advanced.
- *Unify promote:* replace `post('promote')` + the bespoke confirm-then-`post('demote')`
  with the shared `<PromoteButton>`/`<DemoteButton>` (same components Metrics uses).
- The header's `Run`/`Stop` is a legitimate primary for a *ready* system — keep it, but
  only in **View**; in Edit the primary is `Build`.

**Metrics / Dashboards** — already close to target. Only change: move `Demote` +
`Version history` into `⋯ Manage` so the header shows primary + View/Edit + ⋯.

**Big Bets (`app/(plan)/big-bets/[id]`)** — the outlier with no inline View/Edit; it uses
a full-form overlay. Bring it into line: Design/Value stay as content tabs, but `Edit bet`
becomes an inline View/Edit toggle on the Design tab so editing a bet feels like editing a
metric.

## 1.4 The one shared header — `ArtifactHeader`

Introduce a single presentational `ArtifactHeader` (a sibling to `LifecycleActions`, in
`components/lifecycle/` or `components/core/`) that every builder mounts, taking:
`{ name, tier, primaryAction, viewEditState, manageMenu }`. It renders the budget from
1.2 and internally hosts `LifecycleActions` (upgraded to a `⋯` menu) + `PromoteButton`.
This is the same consolidation move that `StageShell` did for the stepper and
`ChooseContextShell` did for grants — one calm chrome, adopted tab by tab, zero new
governance. **Definition of done:** every tab's header is byte-consistent; there is exactly
one promotion path in the codebase.

---

# 2 · A proactive, magic assistant + a start screen

## 2.1 Principle — the assistant *does the work*, quietly

Today's assistant surfaces are excellent *scaffolding* but mostly reactive:

- `StageAssistantChat` (`components/core/StageAssistantChat.tsx`) already returns
  **structured suggestion cards** with `onApply*` callbacks (purpose, grants, epics,
  stories, spec, datasets, improvements) — the host applies through its own governed path,
  the assistant never mutates. It **already supports `autoFirePrompt`** ("PROACTIVELY sends
  this prompt ONCE on entry … so helpful suggestions appear the moment the user lands on a
  stage — no click needed"). This is proactivity, already built — but only Agents/Software
  wire it.
- `AskAssistant` (`components/home/AskAssistant.tsx` → `lib/home/assistant.ts`) has three
  honest modes: `answer`, `scaffold` (one Personal draft), `human-gate` (refuses
  promote/certify). Every turn is Langfuse-traced.

The magic move is to make **"appear and propose, apply on one tap"** the *default*
everywhere, and to lift the scaffolder's ceiling from *one artifact* to *an orchestrated
plan* — using machinery that already exists.

### 2.1.1 Proactive tab assistants (the near-term win)

For every builder tab, mount `StageAssistantChat` (or the tab's stage assistant) with an
`autoFirePrompt` computed from live state, so the assistant *pre-does* the obvious next
step and presents it as a card:

- **Data · Documentation stage:** on entry, auto-propose column docs + DQ checks from the
  profile → `onApplyGrants`-style cards. (Replaces the manual `Draft documentation` /
  `Add a custom check` buttons from §1.)
- **Metrics:** auto-propose a metric definition from the selected dataset's Gold columns.
- **Dashboards:** auto-propose 3 charts from the metric's dimensions.
- **Connections:** auto-suggest the test + first dataset to pull.

Each card is **Apply / Decline** — never auto-committed. This is *just wiring the existing
`autoFirePrompt` + `SuggestionCard` pattern into the tabs that lack it*, so the behaviour,
governance, and honesty states are already proven.

## 2.2 The start screen — "What do you want to build or do today?"

Replace/augment today's `/cockpit` hero + `HomeLauncher` gallery with a single, quiet,
full-attention prompt. **One thing per screen.**

```
                 What do you want to build or do today?
   ┌──────────────────────────────────────────────────────────────┐
   │  e.g. "Give me a weekly churn briefing my team can trust"      │
   └──────────────────────────────────────────────────────────────┘
          Try:  ▸ A churn early-warning system
                ▸ A metric for net revenue retention
                ▸ An agent that drafts renewal emails
```

No gradient, no illustration wall. Below the fold, the existing `Cockpit` "what's moving"
modules remain (they are genuinely useful and governed) — but the **first** screen is the
intent box. The launcher gallery becomes the empty-state fallback / "browse the paths"
affordance, not the front door.

### 2.2.1 Intent capture → classify → plan

The box POSTs to an upgraded `/api/home/ask`. `lib/home/assistant.ts`'s `classifyAsk`
already routes `answer | scaffold | human-gate`. Add a fourth: **`orchestrate`** — the
intent needs *more than one* artifact.

```
intent = classifyAsk(prompt)
  ├─ answer      → today's honest pointer (unchanged)
  ├─ human-gate  → "promotion stays a human decision" (unchanged)
  ├─ scaffold    → one Personal draft + deep-link (unchanged — the fast path)
  └─ orchestrate → propose a PLAN (new) — hand to the Big Bet planner
```

Classification is cheap and honest: if the parsed intent references ≥2 artifact kinds, or
a "system/briefing/pipeline/workflow" noun, it's `orchestrate`.

### 2.2.2 Plan → Preview → Confirm → Execute (the ceremony)

This is where the OS already has the perfect engine and simply hasn't pointed the front
door at it. `lib/bigbets/planner.ts`:

- **`proposePlan(goal)`** → asks the one governed assistant LLM to break the goal into a
  **2–6 step DAG**, each step exactly one artifact in one tab (`data | metric | knowledge |
  connection | dashboard | agent | software | ml`), with `dependsOn`, `offsetDays`,
  `consumes` (upstream artifact ids), and a `rationale`. Returns a validated `ProposedPlan`
  — unknown tabs dropped, no fabricated fallback (honest 502 if unusable).
- **`approvePlan(betId, approver, plan)`** → scaffolds every step through each tab's
  governed create flow, landing each artifact at `planned`, wiring the dependency edges —
  as a **`kind:'planner'` actor that `sources.advance` rejects for every ready/promote/
  certify/go-live transition**. Every step is OPA-authorized + Langfuse-traced via injected
  hooks. *The planner literally has no code path to self-promote.*

So the start-screen flow becomes:

1. **Plan.** `orchestrate` intent → `proposePlan(prompt)`. Show the plan as a calm,
   read-only **preview**: a mini-roadmap of the 2–6 steps ("① a governed *churn features*
   dataset → ② a *NRR* metric on it → ③ a *churn-risk* agent team → ④ a weekly
   *briefing* dashboard"), each with its rationale and what it `consumes`. Reuse the Big
   Bets `Roadmap`/`InterplayCanvas` visual so the preview looks like the workspace it will
   become.
2. **Confirm.** One button: **"Build this plan"**. Copy states plainly: *"I'll create these
   as Personal drafts in your domain. Nothing ships or is shared until you approve each
   one — a human still promotes."* (This is `approvePlan`'s real invariant, surfaced.)
3. **Execute.** Create a Big Bet from the goal (`POST /api/big-bets`), then `approvePlan`
   scaffolds the components. The user lands **in the Big Bet workspace** — now the home for
   this piece of work — with each drafted artifact linked, status derived live from its
   real lifecycle, value tracked against the pillar. The multi-artifact intent has become a
   first-class, governed, trackable object, not a pile of orphan drafts.

For **single-artifact** intents nothing changes — the `scaffold` fast path still drops one
draft and deep-links. The ceremony is reserved for genuinely multi-part work, so the
common case stays instant.

### 2.2.3 Reusing the agent "propose-team" pattern *inside* a plan step

When a plan step is an **agent**, don't just scaffold an empty system — reuse
`lib/agents/propose-team.ts`. Its `proposeTeam(system, description, context)` already
produces a grounded 2–6 agent linear pipeline **referencing only granted assets** (it
builds a CONTEXT block from the system's real DLS-scoped grants and instructs the planner
LLM to never invent an ungranted dataset/metric/connection). So a plan step "an agent that
drafts renewal emails" arrives with a proposed team *already grounded in the churn dataset
the earlier step created*. The `consumes` edges from the plan become the agent's grant
seeds. This is the "auto-suggested team" the Agents builder already ships, promoted to a
composition primitive.

## 2.3 Governance guardrails (non-negotiable, and mostly already true)

Every proactive side-effect stays on the governed path — the assistant is a **front door,
not a back door**:

- **Create, never ship.** `approvePlan`/`proposeTeam`/`ask`-scaffold all land artifacts at
  Personal/`planned`. Promote/certify/publish/deploy/go-live remain human (Builder/Admin+),
  enforced *in code* by the `kind:'planner'` rejection and `ask`'s `human-gate` refusal —
  not by prompt discipline.
- **Human confirm on anything outward or destructive.** Multi-step execution shows the
  preview and requires the single Confirm; any step that would touch an external system
  (egress, a connection write, an email send) is gated per-step with an explicit
  confirmation, mirroring `SystemView`'s existing confirm-then-`post('demote')` and
  `LifecycleActions`' name-gated delete. The assistant proposes; the human commits.
- **OPA + DLS on every step.** The planner's `PlannerHooks.authorize` is wired to the live
  OPA decision API in `server.ts`; `ask` runs as the real viewer via `withRoute`. No step
  escapes policy or row/document-level security.
- **Everything traced.** Every turn/step is Langfuse-traced (`trace()` in `lib/home/
  assistant.ts`, planner `trace` hook), auditable in Monitoring like any other governed
  action. The Big Bet's own `audit[]` records the scaffold.

## 2.4 Graceful degradation (honest, never fake)

- **No LLM configured:** `proposePlan` throws an honest, admin-actionable error (there is
  *no* canned-template fallback — a deliberate choice in `planner.ts`). The start screen
  shows: *"The planning assistant isn't configured yet — you can still build each piece by
  hand,"* and falls back to the `HomeLauncher` gallery. The box never fabricates a plan.
- **Partial scaffold failure:** `approvePlan` returns the `created[]` it achieved; the
  preview turns into a checklist showing which steps succeeded and which need a retry — the
  Big Bet exists with the components that landed, honestly incomplete, never silently.
- **Offline/mock backends:** `sources.sourceMode()` reports `live｜mock` honestly; surface
  it as the single degraded-mode chip from §Recommendation 8.

## 2.5 What NOT to build

No parallel assistant stack. No new chat runtime. The start screen is `AskAssistant`
grown up; the orchestration is `bigbets/planner.ts` pointed at the front door; the tab
proactivity is `autoFirePrompt` wired everywhere; the grounded agent step is
`propose-team.ts`. Every piece exists — this workstream is **composition, not invention.**

---

# 3 · Context curation for 2026 (research-backed)

## 3.1 Where the frontier is (mid-2026)

Context engineering is now a named discipline (coined by Lütke/Karpathy mid-2025,
formalized by Anthropic and LangChain). The consensus stack has moved decisively **beyond
"embed → top-k → stuff the window."** The seven load-bearing ideas, with sources:

**A. Agentic / librarian retrieval.** The reference pattern is *orchestrator → decompose →
parallel sub-agents with isolated context windows → synthesize + cite*. The lead agent's
job is context *engineering* for its sub-agents, not just search.
- Anthropic, *How we built our multi-agent research system* — https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic, *Contextual Retrieval* (prepend an LLM chunk-summary before embedding **and**
  BM25 indexing; −49% retrieval failures, −67% with reranking) — https://www.anthropic.com/engineering/contextual-retrieval
- Singh et al., *Agentic RAG: A Survey* (arXiv 2501.09136) — https://arxiv.org/abs/2501.09136

**B. Hybrid retrieval + fusion.** Parallel BM25 + dense (+ optional learned-sparse), fused
by **Reciprocal Rank Fusion** (rank-based, tuning-free, scale-robust), then rerank; a
**graph path** for multi-hop / global questions.
- Cormack et al., *Reciprocal Rank Fusion* (SIGIR 2009) — https://dl.acm.org/doi/10.1145/1571941.1572114
- Microsoft, *GraphRAG* (arXiv 2404.16130) — https://arxiv.org/abs/2404.16130 ·
  *LightRAG* (2410.05779), *HippoRAG 2* (2502.14802)
- Hybrid search reference (hybrid ~91% recall@10 vs 78% dense-only) — https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026

**C. Memory systems.** CoALA's four types (working/episodic/semantic/procedural); memory
blocks + external files; bitemporal-KG memory; offline consolidation.
- CoALA (arXiv 2309.02427) — https://arxiv.org/abs/2309.02427
- MemGPT (2310.08560) → Letta memory blocks — https://www.letta.com
- Anthropic *Memory tool + context editing* (−84% tokens, +39% on a 100-turn task) — https://claude.com/blog/context-management
- Zep/Graphiti bitemporal KG (2501.13956); Mem0 (2504.19413); Sleep-time Compute (2504.13171)

**D. Context-pack assembly + compaction.** Context is a finite resource with diminishing
returns; budget it, load just-in-time, compact near the limit, offload state to files.
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Effective harnesses for long-running agents* ("state should live in files,
  not the transcript") — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Chroma, *Context Rot* (all frontier models degrade well before the window limit) — https://research.trychroma.com/context-rot
- Microsoft LLMLingua-2 (task-agnostic prompt compression) — https://github.com/microsoft/LLMLingua

**E. Re-ranking.** Cross-encoder / late-interaction / listwise-LLM rerank as the cheap
accuracy lift on top of hybrid.
- Cohere Rerank v3.5 — https://docs.cohere.com/changelog/rerank-v3.5 · mixedbread
  mxbai-rerank-v2 — https://www.mixedbread.com/blog/mxbai-rerank-v2 · Qwen3-Reranker
  (Apache-2.0) — https://qwenlm.github.io/blog/qwen3-embedding/
- RankGPT/RankLLM listwise LLM reranking (arXiv 2505.19284) — https://github.com/castorini/rank_llm ·
  ColBERTv2 late interaction — https://huggingface.co/colbert-ir/colbertv2.0

**F. "Context engineering" as discipline.** Own your window; keep fill low (recall rots
past ~40%); Write / Select / Compress / Isolate.
- LangChain, *Context Engineering for Agents* — https://www.langchain.com/blog/context-engineering
- 12-Factor Agents, Factor 3 *Own Your Context Window* — https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-03-own-your-context-window.md
- Philipp Schmid, *The new skill is context engineering* — https://www.philschmid.de/context-engineering

**G. Governed / permission-aware retrieval.** Enforce source-system permissions *at the
retrieval layer, as a pre-filter*, so ungranted data is never fetched — or you leak.
- Glean permissions model — https://www.glean.com/blog/secure-generative-ai-for-the-enterprise-requires-the-right-permissions-structure
- Cerbos permission-aware RAG (policy → vector-store metadata pre-filters) — https://www.cerbos.dev/features-benefits-and-use-cases/access-control-for-rag
- Microsoft Purview + Copilot (sensitivity-label-aware RAG) — https://learn.microsoft.com/en-us/purview/ai-m365-copilot
- Motivation: OWASP LLM Top-10 2025 ranks Sensitive-Info-Disclosure #2; EchoLeak showed a
  RAG pipeline exfiltrating data.

## 3.2 What the OS has today (and where it sits vs. the frontier)

The `lib/infra/context/` substrate is genuinely good and **already governed** — which is
the hard part most teams get wrong:

- **`context-assembler.ts`** — a pure, budget-aware packer: pinned-first, compact large
  tool-results (`compactToolResult`), score by priority × recency, greedily pack under a
  hard token ceiling, honest `droppedIds` manifest. This is Anthropic's *budgeting +
  compaction* (idea D), correctly implemented — with a `scoreCandidate` **seam** explicitly
  reserved for embedding relevance.
- **`librarian.ts`** — a curation stage *in front of* the packer: embeds the agent's
  **need** (role/prompt + task) + each competing chunk, keeps high-relevance whole,
  compacts mid, drops low, keeps pinned + the immediate `predecessor` handoff whole. It is
  **curate-when-crowded** (no embed cost under budget) and **never a governance bypass**
  ("Candidates arriving here are ALREADY DLS/OPA-filtered upstream … it never fetches,
  widens access, or reaches outside its inputs"). It even has a designed-but-unwired
  **`escalate` LLM-curator seam** for the hardest over-budget cases.
- **`librarian-live.ts`** — honest degradation: `guardedEmbedder()` returns `[]` when the
  embedder is the meaningless `offline-hash` fallback, so the Librarian passes the pool
  through untouched rather than ranking on noise. **This is the honesty gate the whole 2026
  literature demands.**
- **Wired live**, not shelf-ware: `agentic-graph.ts:394` (`curateContext` in agent runs),
  `talk.ts:233` (`curateThenAssemble` for the Talk copilots), via `liveEmbedder`.
- **Granted-context isolation** is real: `propose-team.ts` grounds proposals in *only*
  DLS-scoped granted assets; the OS just shipped the fix ensuring agents only see granted
  context.

So the OS already nails **budgeting, compaction, semantic curation, honest degradation, and
permission-awareness** (ideas D + G, the two hardest). What it is *missing* vs. the frontier:
**hybrid lexical+semantic+graph retrieval (B), re-ranking (E), memory (C), and the full
agentic-librarian loop (A).** The Librarian today *selects* among a pool someone else
retrieved; it is not yet the librarian that *assembles the pool*.

## 3.3 The proposal — the Sovereign Librarian Agent

Grow the existing Librarian from a **budget-aware curator** into a **governed agentic
librarian** that assembles the best possible per-request context for any agent / app /
assistant — built on the OS's own substrate (OpenSearch hybrid index, Haystack,
embeddings, governed Trino), upgraded with the 2026 patterns, and **never leaking ungranted
context.**

### 3.3.1 Retrieval pipeline (new stages *before* the existing packer)

Insert a retrieval front-end that produces the candidate pool `curateContext` already
consumes — so nothing downstream changes:

```
need (role + task + granted-scope)
   │
   ▼  ①  GOVERNED PRE-FILTER  ← permission-aware retrieval (idea G)
   │      resolve the caller's DLS/OPA grants → an allow-set of {dataset, doc, metric,
   │      connection, knowledge, memory} ids. This is the SAME grants substrate
   │      propose-team.ts already uses. Nothing outside the allow-set is ever queried.
   ▼  ②  HYBRID RETRIEVE  (idea B)  over the allow-set only
   │      • OpenSearch BM25 (lexical)         ┐
   │      • embeddings kNN (semantic)         ├─ run in parallel, per source
   │      • graph expansion over registry     ┘   (lineage/consume-edges — the SAME
   │        consume-edges + OpenMetadata lineage bigbets/composition.ts already builds)
   ▼  ③  FUSE with RRF  (idea B)  → one ranked candidate list, scale-robust
   ▼  ④  RE-RANK  (idea E)  cross-encoder (Cohere/Qwen3/bge-v2-m3) or the escalate LLM
   ▼  ⑤  curateContext(...)  ← EXISTING librarian.ts (curate-when-crowded + honesty gate)
   ▼  ⑥  assembleContext(...) ← EXISTING packer (hard budget ceiling + honest manifest)
```

Stages ①②③④ are new; ⑤⑥ are the code that already ships. Corpus prep uses **Contextual
Retrieval** (idea A): when indexing a chunk into OpenSearch, prepend an LLM-generated
document-scoped summary before *both* the embedding and the BM25 field — Anthropic's
highest-leverage single step, and a one-time indexing change, not a runtime cost.

### 3.3.2 The librarian *agent* (idea A)

For hard requests (a research/briefing agent, a Big Bet plan), the librarian becomes a
proper **`kind:'planner'`-style retrieval agent** that: (a) decomposes the need into
sub-queries, (b) runs the hybrid pipeline per sub-query in **isolated windows**, (c)
compacts each result (reuse `compactToolResult`), and (d) hands the synthesized,
**cited** pack to the requesting agent. This is exactly Anthropic's multi-agent research
architecture, but confined to *granted* sources. Wire it into the **existing `escalate`
seam** in `librarian.ts` — that hook was designed for precisely this and is currently a
no-op.

### 3.3.3 Governed memory as a grantable context type (idea C)

Add **agent memory** (`lib/agents/agent-memory.ts` exists as a seed) as a first-class,
DLS-scoped context kind:
- **Episodic** — prior run traces/outputs (the OS already stores run traces).
- **Semantic** — distilled facts about a domain's data/metrics.
- **Procedural** — "how this team does X" (the agent's own learned instructions).

Memory is **granted like any other resource** through `ChooseContextShell` — so an agent
only ever recalls memory it's entitled to, curated by the librarian, and consolidated
offline (Sleep-time Compute pattern) so it never bloats the runtime window. This is the
single biggest "magic" upgrade: agents that *remember* their domain, still perfectly
governed.

### 3.3.4 Staying governed + honest (ideas D + G, preserved)

- **Pre-filter, never post-filter.** The allow-set in stage ① is computed from grants
  *before* any query runs — the Glean/Cerbos/Purview principle. The existing invariant
  ("candidates arriving are ALREADY DLS/OPA-filtered") is preserved and *strengthened*
  (now the retrieval itself is scoped, not just the curation).
- **Honesty gate holds.** `guardedEmbedder` already refuses to rank on `offline-hash`
  vectors; extend the same discipline to the hybrid stage — if OpenSearch/embeddings/
  rerankers are unreachable, degrade *down the stack* (rerank→RRF→BM25-only→existing
  deterministic packer) and **mark the mode** on the assembled pack. Never fabricate
  relevance. (Cf. the memory note: an absurd metric value = Cube unreachable → resolver
  hash-fabricates it; the honesty gate must stop that class of failure here too.)
- **Every assembly is traced** with its `trace[]` manifest (kept-full/compacted/dropped +
  why) — the OS already produces this; surface it in Monitoring so context assembly is as
  auditable as any governed action.

---

# 2b · Assistant-first by default, stages behind "Expert Mode"

## 2b.1 The inversion

Today every builder puts the **staged machine front-and-center** and treats the assistant
as a helper mounted *inside* a stage. The Agents `SimpleBuilder` is the clearest example:
it rides `StageShell` + `AGENT_STAGES` (`lib/agents/stages.ts` — Define · Grant · Design ·
Build · Run · Evaluate) and mounts `AgentStageAssistant` at the *top* of each stage body
with `autoSuggest={editable}`. The stages lead; the assistant assists.

**Invert it.** For a normal user, opening a tab should present **one conversational
assistant that builds the artifact for them** — grounded, governed, proposing → applying
through the exact Apply-suggestion + governed-commit path that already exists. The full
staged builder still exists, unchanged, but it is **revealed on demand** behind an **Expert
Mode** (Expert Modus) toggle for power users who want fine control.

> **Assistant-first / stages-on-demand.** Default surface = talk to build. Expert Mode =
> the staged builder (Agents' six stages, the Data stages, the Software stages) for
> surgical control. This is not a new mode system — it is the **Simple ⇄ Developer toggle,
> already shipping in Agents (`SystemView.tsx` L393–438) and Software, generalized OS-wide
> and re-labelled so its intent is unmistakable.**

## 2b.2 How it composes with the earlier recommendations

This is the connective tissue between §1, §2, and §3 — not a competing idea:

- **It *is* the destination of the "What do you want to build today?" start screen (§2.2).**
  The start screen captures intent; a **single-artifact** intent deep-links into the owning
  tab, which now opens **already in assistant-first mode with the goal seeded as the first
  turn**. So "define a metric for NRR" doesn't drop you at a blank Define stage — it drops
  you into a conversation that has already proposed the metric. The start screen and the
  per-tab assistant become one continuous conversation.
- **It generalizes the proactive `autoFirePrompt` (§2.1.1) from a helper into the primary
  surface.** In §2.1.1 the assistant *pre-does* the next step as a card *inside* a stage.
  Here the same `StageAssistantChat` + `autoFirePrompt` **is the whole default screen**; the
  stage bodies only render when Expert Mode is on. Same component, same cards, same
  `onApply*` governed commit — promoted from sidebar to centre.
- **It leaves the Big-Bet orchestration (§2.2.2) exactly as designed.** Multi-artifact
  intent still routes to `proposePlan` → a Big Bet. Assistant-first is the *per-artifact*
  default; the Big Bet is the *cross-artifact* default. A plan step that lands you in the
  Agents tab opens assistant-first, with `proposeTeam` (§2.2.3) having already seeded the
  team from the plan's `consumes` edges. The two nest cleanly: **conversation to build one
  thing; a plan to build several; both governed, both trackable.**

## 2b.3 The exact mechanism — reuse, don't invent

No new runtime. The building blocks are all present:

1. **Primary surface = `StageAssistantChat`** (`components/core/StageAssistantChat.tsx`),
   mounted full-width as the tab's default body, with:
   - `autoFirePrompt` seeded from live artifact state (and, when arriving from the start
     screen, from the user's intent) so it proposes on entry — no blank box.
   - the tab's existing `onApply*` callbacks (`onApplyPurpose`, `onApplyGrants`,
     `onApplyEpics`, `onApplySpec`, the Agents `renderSuggestions` team/grant cards, the
     Data DQ-check cards, …). **The assistant proposes; the host applies through its own
     governed commit.** This is already how it works — we are just making it the front page.
   - `nextSteps` at the foot so the conversation is never a dead end (it already supports
     this) — e.g. "Grant it the churn dataset", "Build & test", "Ready to promote?".
2. **The stage machine renders only under Expert Mode.** `StageShell` + the tab's
   `lib/*/stages.ts` (`AGENT_STAGES`, `DATA_STAGES`, `SW_STAGES`, `METRIC_STAGES`) are
   **untouched** — they simply don't mount unless Expert Mode is on. The stage *state*
   (`StageState`, gating in `lib/core/stages.ts`) keeps advancing in the background as the
   assistant applies suggestions, so flipping to Expert Mode drops the user at exactly the
   right stage on the artifact's *real* state (the gating already derives from real state,
   e.g. `AGENT_STAGES` gates Build on `ready`, Run on green build, Evaluate on `hasRun`).
3. **The toggle = the generalized Simple/Developer control.** Rename the OS-wide
   `BuilderModeToggle` axis to **`Assistant · Expert`** (keeping the persisted-per-user
   `view-mode` machinery and localStorage key already in `SystemView`/`DataBuilder`).
   Default is **Assistant** for everyone (mirroring today's "Simple is the front door for
   admins too" default in `resolveInitialMode`). This folds *into* the §1.4 `ArtifactHeader`
   as the single mode control, so the header still honours the control budget: `← Back ·
   name · primary · Assistant｜Expert · ⋯`.

Net: the *same* artifact, the *same* governed commit path, the *same* stage machine — the
toggle only decides whether the human drives via **conversation** or via **the staged
canvas**. Nothing forks; the source of truth (e.g. `system.yaml`, `dataset.yaml`) is
identical either way, exactly as the Simple/Developer toggle already guarantees ("Both edit
the SAME system.yaml through the SAME commit path — the toggle only changes the surface").

## 2b.4 Governed and honest (unchanged invariants)

Assistant-first changes the *surface*, never the *governance*:

- **Assistant proposes, human confirms every side-effect.** `StageAssistantChat` never
  mutates — each suggestion is an Apply card the user taps, and the host persists through
  its governed route. Promote/certify/publish/deploy stay human (the `human-gate` refusal in
  `lib/home/assistant.ts`, the `kind:'planner'` rejection in the planner). An assistant-first
  Agents tab can *build and test* a team by conversation, but "Promote to Domain" is still a
  deliberate human tap on the shared `<PromoteButton>`.
- **One commit path.** Every applied suggestion flows through the same route the staged
  builder uses (`commitSystem`, the dataset commit, `createArtifact`) — OPA-checked,
  DLS-filtered, Langfuse-traced. There is no assistant-only write door.
- **Grounded, never fabricated.** The conversation's proposals are grounded by the Context
  Librarian (§3) on *granted* context only — the same substrate `proposeTeam` uses to avoid
  referencing ungranted assets. If the LLM is unconfigured, the tab says so and offers
  Expert Mode as the manual fallback (honest degradation, no fake build).

## 2b.5 Per-tab: where assistant-first is natural vs where Expert Mode is essential

| Tab | Assistant-first fit | Expert Mode is essential for… |
|---|---|---|
| **Metrics** | **Excellent.** "Define NRR on the subscriptions asset" → proposed definition card → Apply → View. Most metrics are one conversational turn. | Editing the raw semantic-layer SQL / window / filters by hand. |
| **Data** | **Strong** for documentation, DQ checks, transformations (all already Apply-card shaped). Talk-to-Data already lives in View. | Column-level join composition, the Refine toggle matrix, `dataset.yaml`, layer/preview control. |
| **Dashboards** | **Excellent.** "Chart churn by region from the NRR metric" → proposed panels → Apply. | Precise panel layout, axis/member tuning, grid arrangement. |
| **Agents** | **Strong** — `proposeTeam` already turns a plain description into a grounded team; conversation replaces manual canvas wiring for most users. | The graph canvas, per-agent model/tool grants, `system.yaml`, supervise/handoff topology, routing. **Expert Mode is genuinely needed here** — power users think in the DAG. |
| **Software** | **Strong** for Define/epics/stories/spec (all already `StageAssistantChat` cards). | The Build tree, code review, deploy config — the multi-stage `SW_STAGES` flow. |
| **Connections** | **Excellent.** "Connect our Postgres and pull the orders table" → guided by conversation, test on Apply. | Credential/driver detail, promotion of a shared connection. |
| **Knowledge / Workflows** | **Good** for authoring/summarizing. | The swimlane canvas + actor/handover modelling. |
| **Science** | **Good** — `ScienceChat` is already a conversation; make it the default. | Runtime selection, training/deploy config (recall the KServe runtime-pinning class of detail). |
| **Big Bets** | **Assistant-first *is* the start-screen plan flow** — describe the goal, preview the plan, confirm. | The roadmap Gantt, value allocation, composition graph. |

Rule of thumb: **assistant-first is natural wherever the artifact is mostly declarative
(a metric, a chart, a doc, a team description); Expert Mode is essential wherever the
artifact has irreducible topology or low-level config (the agent DAG, data joins, deploy
runtime, dashboard layout).** Every tab keeps both; the default just changes.

## 2b.6 What NOT to build

Do not build a second assistant or a second commit path. Do not hide the stages *from*
Expert users or gate Expert Mode behind a role — it is a *preference*, remembered per user,
defaulting to Assistant. Do not let the assistant perform a governed transition the staged
builder wouldn't. The whole move is one relabelled toggle + mounting an existing component
as the default body.

---

# Sequenced roadmap

Effort **S/M/L**, impact **medium/high/very-high**. Ordered quick-wins → bigger bets.

### Quick wins
| # | Item | Effort | Impact |
|---|---|---|---|
| Q1 | **Control budget adopted** — collapse Archive/Delete/Versions/Demote into one `⋯ Manage` menu inside `LifecycleActions`; header shows Back · name · one primary · ⋯. | S | high |
| Q2 | **One degraded-mode chip** — unify Librarian `fallback`/`offline-mock` + planner `sourceMode()` into a single calm "running offline / degraded" indicator. | S | medium |
| Q3 | **Merge Data's redundant CTAs** — role-switch one Certify/Request button; fold Checks' 6 verbs into assistant Apply + Save. | S | high |
| Q4 | **Kill the Agents double toggle** — one `View · Edit · Advanced` control. | S | high |
| Q5 | **Proactive on entry** — turn on `autoFirePrompt` for the tabs already mounting a stage assistant; verify no double-fire. | S | high |

### Medium bets
| # | Item | Effort | Impact |
|---|---|---|---|
| M1 | **Unify promotion** — single `<PromoteButton>`/`<DemoteButton>` across all tabs; retire `promoteBlock` + `post('promote')`. | M | high |
| M2 | **`ArtifactHeader`** shared chrome — every builder mounts the same header (hosts PromoteButton + Lifecycle&nbsp;⋯). | M | high |
| M3 | **Proactive assistants for the assistant-less tabs** — mount `StageAssistantChat` in Data/Metrics/Dashboards/Connections with state-derived `autoFirePrompt` + Apply cards. | M | high |
| M4 | **`orchestrate` intent + Plan→Preview→Confirm** — `classifyAsk` fourth mode; `proposePlan` preview UI reusing the Big Bets roadmap visual. | M | very high |
| M5 | **Wire the `escalate` LLM-curator seam** in `librarian.ts` for over-budget tails. | M | high |
| M6 | **Assistant-first pilot (Metrics + Dashboards)** — mount `StageAssistantChat` as the default full-width body; relabel `BuilderModeToggle` → `Assistant · Expert` (default Assistant); stage machine renders only under Expert. Two most declarative tabs first (§2b). | M | very high |

### Bigger bets
| # | Item | Effort | Impact |
|---|---|---|---|
| B1 | **"What do you want to build today?" start screen** as the front door — full flow: intent → plan → Big Bet execution via `approvePlan`; grounded agent steps via `proposeTeam`. | L | very high |
| B2 | **Hybrid retrieval front-end** (OpenSearch BM25 + embeddings kNN + graph expansion → RRF → rerank) feeding `curateContext`; Contextual-Retrieval corpus prep at index time. | L | high |
| B3 | **Sovereign Librarian Agent** — decompose → parallel isolated retrieval → synthesize + cite, on the `escalate` seam, granted-scope only. | L | high |
| B4 | **Governed agent memory** (episodic/semantic/procedural) as a grantable context type in `ChooseContextShell`, curated by the librarian, consolidated offline. | L | high |
| B5 | **Assistant-first OS-wide** — extend the §2b default to every builder (Data, Agents, Software, Connections, Knowledge, Science, Big Bets); wire the start screen to open the owning tab assistant-first with the intent seeded as turn one; Expert Mode reveals the full staged builder unchanged. | L | very high |

**Sequencing logic:** Q1–Q5 are pure surface calm and one-flag proactivity — days, not
weeks, all reversible. M1–M2 pay down the promotion/header inconsistency debt so the start
screen (B1) can rely on one governed path. M3–M4 make the assistant feel alive tab-by-tab
and prove the plan-preview UX *before* B1 makes it the front door. **M6 pilots
assistant-first on the two most declarative tabs — the smallest test of the biggest
inversion — so B5 rolls it OS-wide only after the pattern is proven.** B2–B4 upgrade the
context substrate underneath everything — they make the *magic* (agents that retrieve the
right thing, remember their domain, and stay perfectly governed) real, and they slot into
seams (`scoreCandidate`, `escalate`) the codebase already left open for exactly this.

**The through-line:** every recommendation is composition of parts that already exist —
`StageShell`, `LifecycleActions`, `PromoteButton`, `ChooseContextShell`, `StageAssistantChat`
+ `autoFirePrompt`, the `BuilderModeToggle` (relabelled `Assistant · Expert`),
`AskAssistant`, `bigbets/planner.ts`, `propose-team.ts`, and the `librarian`/`assembler`
with their open seams. The OS doesn't need more surface. It needs **fewer, calmer controls;
an assistant you talk to that builds the thing for you (with the full staged builder one
"Expert Mode" tap away); and its own best substrate turned all the way up** — all behind one
elegant surface.
