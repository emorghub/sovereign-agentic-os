<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->
# Deep-import exceptions (#20)

Every line that still imports a base module by deep path instead of its barrel,
with the reason it cannot go through the barrel. This is the list behind the
summary table in PR #47, and the starting allow-list for the dependency-cruiser
rule in #34.

Regenerate the raw list with:

```bash
grep -rn "@/lib/\(infra\|assistant\|monitoring\|models\|oauth\|home\|governance\)/" \
  os-ui/lib os-ui/app os-ui/components --include=*.ts --include=*.tsx
```

The `--include` filters to code. Running the same grep without them adds 18 lines of
README prose in `lib/assistant`, `lib/governance` and `lib/infra` that describe these
very exceptions — documentation, not imports, and deliberately not listed below.

## Summary

| # | Reason | Count | In the module graph? |
|---|---|---:|---|
| 1 | Name collision — `infra/governed` and `infra/agent-governed` both export `authorize`, `trace`, `SALES`, `ToolName`, `Authz` with different shapes | 41 | yes |
| 2 | `mock.module()` must name the exact file, never the barrel | 13 | **no** — string argument |
| 3 | `'use client'` value import of `governance/edit-scope` | 13 | yes |
| 4 | Deliberate lazy `await import()` | 9 | yes |
| 5 | Next-runtime-only — `infra/identity-server` reaches `next/headers` | 6 | yes |
| 6 | `ensureHydrated` collision (`approvals` vs `standing`) | 3 | yes |
| 7 | Documentation prose (README / docblock) | 6 | **no** — comment text |
| 8 | Real-module import paired with a spread mock | 12 | yes |
| 9 | Other — cycle, purity contract, fixtures, type-only | 9 | yes |
|   | **Total** | **112** | **93 visible** |

### Note for #34

The grep returns **112** lines, but dependency-cruiser analyses the *module
graph*: it cannot see the 13 `mock.module('…')` string arguments or the 6
documentation comments. The allow-list needs the **93** entries in groups
1, 3, 4, 5, 6, 8 and 9 — adding the other 19 would leave entries the rule can
never match and that nothing will ever expire.

Groups 2 and 8 pair up: each spread mock has one `const real… = await import()`
above its `mock.module()`. 12 of the 13 mocks are in files this PR touched; the
13th (`launch-grounding.test.ts` → `@/lib/infra/k8s`) is not, so it has no
matching import.

---

## 1. name collision (governed vs agent-governed)  (41)
- `os-ui/lib/data/adopt-connected.ts:8` → `@/lib/infra/agent-governed`
- `os-ui/lib/home/assistant.ts:28` → `@/lib/infra/agent-governed`
- `os-ui/lib/science/serve.ts:5` → `@/lib/infra/agent-governed`
- `os-ui/lib/science/model-service.ts:10` → `@/lib/infra/agent-governed`
- `os-ui/lib/connections/exposures.ts:8` → `@/lib/infra/agent-governed`
- `os-ui/lib/connections/warehouse/catalog-classification.ts:8` → `@/lib/infra/agent-governed`
- `os-ui/lib/connections/exposure-propagation.ts:14` → `@/lib/infra/agent-governed`
- `os-ui/lib/connections/store.ts:208` → `@/lib/infra/agent-governed`
- `os-ui/lib/connections/action-adoptions.ts:8` → `@/lib/infra/agent-governed`
- `os-ui/lib/talk/talk.ts:31` → `@/lib/infra/governed`
- `os-ui/lib/files/retrieve.ts:6` → `@/lib/infra/agent-governed`
- `os-ui/lib/bigbets/server.ts:5` → `@/lib/infra/governed`
- `os-ui/lib/knowledge/retrieve.ts:7` → `@/lib/infra/agent-governed`
- `os-ui/lib/agents/build/os-tools.ts:17` → `@/lib/infra/agent-governed`
- `os-ui/lib/agents/build/server.ts:6` → `@/lib/infra/agent-governed`
- `os-ui/lib/agents/build/live-clients.ts:6` → `@/lib/infra/agent-governed`
- `os-ui/lib/agents/build/agentic-graph-server.ts:10` → `@/lib/infra/agent-governed`
- `os-ui/lib/mcp/server.ts:10` → `@/lib/infra/governed`
- `os-ui/lib/mcp/science-write-tools.ts:9` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/review.ts:16` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/platform-mcp.ts:23` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/app-tool-call.ts:6` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/lifecycle.ts:17` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/apps.ts:25` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/ci-repair.ts:10` → `@/lib/infra/agent-governed`
- `os-ui/app/api/agent/tool/route.ts:6` → `@/lib/infra/agent-governed`
- `os-ui/app/api/agent/approvals/route.ts:9` → `@/lib/infra/agent-governed`
- `os-ui/app/api/data/agent/route.ts:6` → `@/lib/infra/governed`
- `os-ui/app/api/data/tool/route.ts:6` → `@/lib/infra/governed`
- `os-ui/app/api/data/sales-agent/route.ts:6` → `@/lib/infra/governed`
- `os-ui/app/api/data/parity/route.ts:6` → `@/lib/infra/governed`
- `os-ui/app/api/data/sandbox/route.ts:6` → `@/lib/infra/governed`
- `os-ui/app/api/data/ask/route.ts:9` → `@/lib/infra/governed`
- `os-ui/app/api/science/model/[model]/deploy/route.ts:7` → `@/lib/infra/agent-governed`
- `os-ui/app/api/science/model/[model]/route.ts:7` → `@/lib/infra/agent-governed`
- `os-ui/app/api/science/model/[model]/train/route.ts:8` → `@/lib/infra/agent-governed`
- `os-ui/app/api/science/model/[model]/folder/route.ts:7` → `@/lib/infra/agent-governed`
- `os-ui/app/api/science/model/route.ts:7` → `@/lib/infra/agent-governed`
- `os-ui/app/api/agents/tool/route.ts:5` → `@/lib/infra/agent-governed`
- `os-ui/app/api/metrics/alerts/route.ts:5` → `@/lib/infra/agent-governed`
- `os-ui/app/api/platform-admin/_ctx.ts:7` → `@/lib/infra/governed`

## 2. mock.module() must name the exact file  (13)
- `os-ui/lib/data/build/live-clients.test.ts:22` → `@/lib/infra/governed`
- `os-ui/lib/science/launch-grounding.test.ts:17` → `@/lib/infra/k8s`
- `os-ui/lib/science/assistant-grounding.test.ts:66` → `@/lib/infra/governed`
- `os-ui/lib/connections/expose-assistant-route.test.ts:42` → `@/lib/assistant/complete`
- `os-ui/lib/metrics/build/explore-presave.test.ts:23` → `@/lib/infra/governed`
- `os-ui/lib/metrics/build/live-clients.test.ts:27` → `@/lib/infra/governed`
- `os-ui/lib/software/data-plan-server.test.ts:21` → `@/lib/assistant/complete`
- `os-ui/lib/software/ask-app-origin-route.test.ts:65` → `@/lib/models/roles`
- `os-ui/lib/software/ask-app-origin-route.test.ts:111` → `@/lib/assistant/runtime`
- `os-ui/lib/software/ask-app-origin-route.test.ts:125` → `@/lib/infra/governed`
- `os-ui/lib/software/app-tool-call.test.ts:21` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/app-tool-call.test.ts:37` → `@/lib/governance/approvals`
- `os-ui/app/api/agents/systems/[id]/assistant/route.test.ts:48` → `@/lib/assistant/complete`

## 3. use-client value import of edit-scope  (13)
- `os-ui/app/(context)/knowledge/page.tsx:13` → `@/lib/governance/edit-scope`
- `os-ui/components/data/DataBuilder.tsx:10` → `@/lib/governance/edit-scope`
- `os-ui/components/data/DatasetTiles.tsx:11` → `@/lib/governance/edit-scope`
- `os-ui/components/science/ModelTiles.tsx:11` → `@/lib/governance/edit-scope`
- `os-ui/components/science/ModelBuilder.tsx:11` → `@/lib/governance/edit-scope`
- `os-ui/components/connections/ConnectionBuilder.tsx:38` → `@/lib/governance/edit-scope`
- `os-ui/components/files/FilePreview.tsx:18` → `@/lib/governance/edit-scope`
- `os-ui/components/files/FilesBrowser.tsx:26` → `@/lib/governance/edit-scope`
- `os-ui/components/agents/SystemsList.tsx:11` → `@/lib/governance/edit-scope`
- `os-ui/components/metrics/MetricsRegistry.tsx:12` → `@/lib/governance/edit-scope`
- `os-ui/components/metrics/MetricBuilder.tsx:12` → `@/lib/governance/edit-scope`
- `os-ui/components/dashboards/Tiles.tsx:11` → `@/lib/governance/edit-scope`
- `os-ui/components/dashboards/DashboardBuilder.tsx:11` → `@/lib/governance/edit-scope`

## 4. deliberate lazy await import()  (9)
- `os-ui/lib/governance/cost.ts:99` → `@/lib/monitoring/adapters/cost`
- `os-ui/lib/science/model-service.ts:730` → `@/lib/infra/agent-governed`
- `os-ui/lib/science/deploy.ts:113` → `@/lib/infra/k8s`
- `os-ui/lib/science/training.ts:232` → `@/lib/infra/k8s`
- `os-ui/lib/connections/cloud-keyservices-store.test.ts:25` → `@/lib/infra/secrets`
- `os-ui/lib/connections/rotate-credential.test.ts:18` → `@/lib/infra/secrets`
- `os-ui/lib/connections/connector-wave-store.test.ts:27` → `@/lib/infra/secrets`
- `os-ui/lib/connections/exposure-actions.test.ts:21` → `@/lib/governance/approvals`
- `os-ui/lib/software/build-service.ts:281` → `@/lib/infra/k8s`

## 5. Next-runtime-only (next/headers)  (6)
- `os-ui/app/api/metrics/govern/route.ts:9` → `@/lib/infra/identity-server`
- `os-ui/app/api/metrics/preview/route.ts:10` → `@/lib/infra/identity-server`
- `os-ui/app/api/metrics/define/route.ts:10` → `@/lib/infra/identity-server`
- `os-ui/app/api/metrics/explore/route.ts:8` → `@/lib/infra/identity-server`
- `os-ui/app/api/metrics/[id]/promote/route.ts:9` → `@/lib/infra/identity-server`
- `os-ui/app/api/dashboards/panel-query/route.ts:8` → `@/lib/infra/identity-server`

## 6. ensureHydrated collision  (3)
- `os-ui/lib/software/review.ts:22` → `@/lib/governance/approvals`
- `os-ui/app/api/governance/policies/route.ts:13` → `@/lib/governance/standing`
- `os-ui/app/api/governance/approvals/route.ts:15` → `@/lib/governance/approvals`

## 7. documentation prose (README / docblock)  (6)
- `os-ui/lib/governance/index.ts:8` → `@/lib/governance/approvals`
- `os-ui/lib/infra/index.ts:16` → `@/lib/infra/governed`
- `os-ui/lib/infra/index.ts:29` → `@/lib/infra/identity-server`
- `os-ui/lib/metrics/build/live-clients.test.ts:13` → `@/lib/infra/governed`
- `os-ui/lib/oauth/index.ts:10` → `@/lib/oauth/providers`
- `os-ui/lib/assistant/index.ts:17` → `@/lib/assistant/complete`

## 8. real-module import for a spread mock (NEW)  (12)
- `os-ui/lib/data/build/live-clients.test.ts:20` → `@/lib/infra/governed`
- `os-ui/lib/science/assistant-grounding.test.ts:64` → `@/lib/infra/governed`
- `os-ui/lib/connections/expose-assistant-route.test.ts:37` → `@/lib/assistant/complete`
- `os-ui/lib/metrics/build/explore-presave.test.ts:21` → `@/lib/infra/governed`
- `os-ui/lib/metrics/build/live-clients.test.ts:25` → `@/lib/infra/governed`
- `os-ui/lib/software/data-plan-server.test.ts:19` → `@/lib/assistant/complete`
- `os-ui/lib/software/ask-app-origin-route.test.ts:63` → `@/lib/models/roles`
- `os-ui/lib/software/ask-app-origin-route.test.ts:109` → `@/lib/assistant/runtime`
- `os-ui/lib/software/ask-app-origin-route.test.ts:123` → `@/lib/infra/governed`
- `os-ui/lib/software/app-tool-call.test.ts:19` → `@/lib/infra/agent-governed`
- `os-ui/lib/software/app-tool-call.test.ts:35` → `@/lib/governance/approvals`
- `os-ui/app/api/agents/systems/[id]/assistant/route.test.ts:43` → `@/lib/assistant/complete`

## 9. other (cycle / purity / fixtures / type-only)  (9)
- `os-ui/lib/mcp/monitoring-tools.test.ts:9` → `@/lib/monitoring/mock`
- `os-ui/lib/software/appspec/generate.ts:29` → `@/lib/assistant/json-reply`
- `os-ui/lib/software/appspec/generate-server.ts:8` → `@/lib/assistant/complete`
- `os-ui/lib/assistant/budget-messages.test.ts:7` → `@/lib/infra/context/context-assembler`
- `os-ui/lib/assistant/agentic.ts:9` → `@/lib/infra/context/context-assembler`
- `os-ui/app/api/governance/approvals/seed/route.ts:6` → `@/lib/governance/seed`
- `os-ui/components/lifecycle/useApprovalNotifier.ts:31` → `@/lib/governance/approval-notice`
- `os-ui/components/connections/ConnectionBuilder.tsx:41` → `@/lib/oauth/providers`
- `os-ui/components/connections/ConnectionBuilder.tsx:42` → `@/lib/oauth/drive-status`

