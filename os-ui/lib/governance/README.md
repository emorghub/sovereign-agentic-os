<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
-->

# Governance — the control plane

Governance **consolidates, decides, and records**. It does **not** author policy —
that stays in each tab (Connections authors capability profiles, Agents authors
safety presets, Data authors grants). Here you **approve · see policy · audit ·
cap cost · manage access**. Spec: [`governance-golden-path.md`](../../../../stackit/governance-golden-path.md).

## Public API

Import via `@/lib/governance` (the barrel):

- `cost.ts` — `setCap`, `listCaps`, `addSpend`, `getSpend`,
  `reconcileSpendFromLiteLLM`, `checkCap`, `__resetCost`, + its types
- `roles.ts` — `roleRank`, `roleLabel`, `ROLE_RIGHTS`, `rightsToTools`,
  `principalFor`, `inScope`, `canSee`, `canApprove`, `canManageRole`,
  `canAdministerUsers`, `userAdminInScope`, `canTouchUser`, `writeGrantsToOpa`,
  `compileRoleToGrants`, + its types
- `effects.ts` — `applyEffect`, + its types
- `audit.ts` — `record`, `search`, `verifyChain`, `__resetAudit`, + its types
- `policy-view.ts` — `canViewPolicyPlane`, `addAccessGrant`,
  `addEgressEndpoint`, `isEgressAllowed`, `listEgress`, `overrideRevoke`,
  `isRevoked`, `consolidatedPlane`, `policySources`, `readOpaGrants`,
  `__resetPlane`, + its types
- `ladder.ts` — `isLadderKind`, `resolveLadderArtifact`,
  `fileArtifactPromotion`, `fileArtifactCertification`, `buildEffectDeps`,
  `promoteThroughSeam`, `promoteOrRequest`, `isDemotableKind`,
  `demoteThroughSeam`, + its types
- `approvals.ts` (`server-only`) — `enqueue`, `listApprovals`, `getApproval`,
  `decide`, `recordEffect`, `__resetApprovals`, + its types.
  `ensureHydrated` is **not** re-exported — collides with `standing.ts`.
- `edit-scope.ts` (pure re-export shim for `lib/core/edit-scope`) —
  `canManageArtifact`, `type ArtifactScope`
- `approval-notice.ts` (pure) — `POLICIES_PATH`, `policiesHref`,
  `canApproveInline`, `targetScopeWord`, `approvalNotice`, + its types
- `governance.ts` — `buildPreview`, `rememberPolicy`, `matchStandingPolicy`,
  `revokeStandingPolicy`, `_clearStandingPolicies`, `SAFETY_PRESETS`,
  `resolveAutonomous`, `setDomainDefaultPreset`, `setAgentPreset`,
  `setAgentToolPreset`, `_clearPresets`, `effectivePreset`, + its types.
  `StandingPolicy` is **not** re-exported — collides with `standing.ts`.
- `standing.ts` — `matchKey`, `remember`, `isRemembered`, `listStanding`,
  `__resetStanding`. Neither `ensureHydrated` nor `StandingPolicy` is
  re-exported — both collide.
- `role-config.ts` — `COMPONENTS`, `CAPABILITIES`, `cellRights`,
  `isApplicable`, `matrixToRights`, `DEFAULT_MATRIX`, `isValidMatrix`,
  `getMatrix`, `ensureRoleConfigLoaded`, `getMatrixSync`, `resolveRoleRights`,
  `setCapability`, `__resetRoleConfig`, + its types

### Documented exceptions (deep-path, intentional)

- `lib/software/review.ts`, `app/api/governance/approvals/route.ts`,
  `app/api/governance/policies/route.ts` — each needs `ensureHydrated`
  alongside other, non-colliding names; the collision keeps `ensureHydrated`
  on its own deep import (`@/lib/governance/approvals` or
  `@/lib/governance/standing`) while the rest goes through the barrel.
- `app/api/governance/approvals/seed/route.ts` — `seedGovernanceDemo` from
  `seed.ts`, a demo seeder with this one consumer; not re-exported.
- `lib/connections/exposure-actions.test.ts:21` — a deliberate lazy
  `await import('@/lib/governance/approvals')`.
- `lib/software/app-tool-call.test.ts:41` — `mock.module('@/lib/governance/approvals', ...)`
  targets the file directly; it must supply every named export of
  `approvals.ts` because the barrel re-exports the full surface.
- 13 `'use client'` components import `canManageArtifact` (`edit-scope.ts`) or
  `approvalNotice`/`FiledApproval` (`approval-notice.ts`) as VALUES; since the
  barrel also re-exports `server-only` surfaces (`approvals.ts`, `ladder.ts`),
  these stay deep-path: `components/lifecycle/useApprovalNotifier.ts`,
  `components/data/DataBuilder.tsx`, `components/data/DatasetTiles.tsx`,
  `components/science/ModelTiles.tsx`, `components/science/ModelBuilder.tsx`,
  `components/connections/ConnectionBuilder.tsx`,
  `components/files/FilePreview.tsx`, `components/files/FilesBrowser.tsx`,
  `components/agents/SystemsList.tsx`, `components/metrics/MetricsRegistry.tsx`,
  `components/metrics/MetricBuilder.tsx`, `components/dashboards/Tiles.tsx`,
  `components/dashboards/DashboardBuilder.tsx`,
  `app/(context)/knowledge/page.tsx`. Type-only imports of the same modules
  (e.g. `type FiledApproval`) go through the barrel — types erase at compile
  time.

### Note — `canManageArtifact` reaches core through a shim

`governance/edit-scope.ts` is a one-line re-export of `lib/core/edit-scope.ts`
(`export * from '../core/edit-scope'`). The 13 `'use client'` components
importing `canManageArtifact` through `@/lib/governance/edit-scope` are really
consuming a pure `core` helper. Pointing them at `@/lib/core/edit-scope`
directly would remove most of the exceptions below — out of scope here, but
worth deciding before #34.

## The one principle: an approval **is** an action

On **Approve**, the platform doesn't just flip a flag — it **executes the governed
effect** behind the card (deploy the app · grant access · allowlist the endpoint ·
promote/certify · run the queued action) **and** writes **audit** + (optionally) a
**standing policy**. The user sees a card; the effect happens behind it.

## Five sections → five adapters

| UI section | Adapter (lib) | What Approve does | Live backend | Offline-mock |
|---|---|---|---|---|
| **Approvals inbox** | `effects.ts` (per-source) | deploy · grant · egress · promote · run | Argo / OPA / egress proxy / OpenMetadata | marked `live:false`, plane mutated in-process |
| **Policies** | `policy-view.ts` | Admin **override** (revoke a grant) | reads live OPA grants | role-derived plane compiled in-process |
| **Audit** | `audit.ts` | — (records every effect) | Langfuse mirror + OpenMetadata lineage | hash-chained in-process log |
| **Cost & limits** | `cost.ts` | set cap → enforce over-cap | LiteLLM budgets | in-process caps + `checkCap` |
| **Users & access** | `roles.ts` (+ `lib/platform-admin`) | role-per-domain → **OPA grants** | OS-native identities (scrypt, `lib/core/password.ts`) + OPA write-through | in-process directory + compile |

The **approval queue itself** is `lib/approvals.ts` (reused, extended with the five
async sources + scope/approver/preview). `standing.ts` is the "approve & remember"
store. `seed.ts` stubs the upstream sources (Software/Agents/Data/Connections) so
the gate runs on `kind`; the real sources reconcile at consolidation.

## Roles & scope (`roles.ts`)

Roles are **Creator · Builder · Domain admin · Admin** (lowest→highest; the wire
enum is `creator | builder | domain_admin | admin`). A user's **role-per-domain** is
the source; `roles.ts` is the compiler → **OPA grants** every tab enforces.

- **Creator** — sees + acts on **their own** requests.
- **Builder** — approves **Personal→Shared** in their domain (queues / policy /
  audit); an approver, not a people-admin.
- **Domain admin** — Builder rights + administers users in their **own** domain
  (invite / edit / deactivate; assigns roles up to Builder).
- **Admin** — **tenant-wide** (all domains, egress, tenant defaults, caps, users)
  and the only role that appoints a Domain admin.

`canSee`, `canApprove`, `canManageRole` enforce this; egress / tenant items are
Admin-only (`scope: 'tenant'`).

## Credentials

This module **never handles raw credentials in the approval path**. Inviting a user
assigns **role + membership** only; account creation / passwords are **OS-native**
(scrypt-hashed, `lib/core/password.ts` + `lib/platform-admin`) — no external identity
provider. The governance approval surface itself takes no `password`.

## Dual pattern (live + offline-mock)

Every adapter is authoritative **in-process** (so it works with no cluster) with a
**best-effort write-through** to the real backend (OPA `PUT /v1/data/grants`,
Langfuse ingestion, OpenSearch mirror). When the backend is unreachable the effect
is **clearly marked `live:false`** and the teaching flow still proves the decision.

## API (`app/api/governance/*`)

| Route | Verbs | Purpose |
|---|---|---|
| `/api/governance/approvals` | GET · POST | scoped queue; decide → effect → audit (+ standing) |
| `/api/governance/approvals/seed` | POST | demo-seed seam (Builder/Admin); `seedGovernanceDemo` now returns `[]` — the real sources (Software/Agents/Data/Connections) reconcile at consolidation |
| `/api/governance/policies` | GET · POST | consolidated plane; Admin override |
| `/api/governance/audit` | GET | searchable record + chain integrity |
| `/api/governance/cost` | GET · POST | list / set caps |
| `/api/governance/cost/check` | POST | enforcement seam (over-cap → 403) |
| `/api/platform-admin/access` | GET · POST · PATCH | invite / role-per-domain / deactivate (OS-native, scrypt) |

## Tests

`node --test 'lib/governance/*.test.ts'` (part of `npm test`). Covers the gate:
scope (Builder=domain vs Admin=tenant; non-Builder can't deploy), approval→effect
(deploy / access-grant / egress / promote / autonomous), Admin override, cost caps
(over-cap blocked), audit who/when/why + chain, approve-&-remember.

## What's mocked on `kind`

Argo deploy, the egress proxy, OpenMetadata promote, and live LiteLLM calls are
**mocked** (marked `live:false`). The **policy/access/egress plane is real
in-process** (so the consumer truly can query, the endpoint truly is allowlisted).
Identities are OS-native (no external IdP). A real deploy reconciles these into
OPA/LiteLLM.
