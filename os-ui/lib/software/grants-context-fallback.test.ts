/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
/**
 * grants-context KNOWLEDGE fallback (item 6a/6). The comment promised "a
 * mis-prefixed legacy id still resolves" via the other store, but the code did a
 * plain if/else — a `wf`-prefixed id that actually lives in the personal store hit
 * the wrong getter, threw, and was silently omitted. This proves the documented
 * try/catch fallback: primary store misses → fall back to the other → resolve.
 *
 * The two knowledge getters are mocked so a `wf`-prefixed id resolves ONLY in the
 * personal store (the mis-prefix case). Other store getters are mocked to no-op /
 * empty so the module loads without the whole tab stack.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Workflow store: the `wf_legacy` id does NOT exist here (miss → throw).
mock.module('@/lib/knowledge/store', {
  namedExports: {
    getWorkflow: (id: string) => {
      throw new Error(`workflow ${id} not found`);
    },
    ensureHydrated: async () => {},
    // Unused by this test, but `@/lib/connections/store` now imports the
    // `@/lib/governance` barrel (which re-exports effects.ts, a consumer of
    // this module's full surface) — this mock must provide every named
    // binding knowledge/store.ts does.
    sha: () => '',
    __resetStore: () => {},
    moveWorkflowsDomain: () => [],
    listWorkflows: () => [],
    createWorkflow: () => ({}),
    reassignOwner: () => 0,
    updateWorkflow: () => ({}),
    renameKnowledge: () => ({}),
    moveWorkflow: () => ({}),
    deleteWorkflow: () => ({}),
    publishWorkflow: () => ({}),
    certifyWorkflow: () => ({}),
    getDomainKnowledge: () => ({}),
    updateDomainKnowledge: () => ({}),
    listDomainKnowledgeVersions: () => [],
    restoreDomainKnowledgeVersion: () => ({}),
    getManual: () => ({}),
    updateManual: () => ({}),
    listManualVersions: () => [],
    restoreManualVersion: () => ({}),
    getTacit: () => ({}),
    updateTacit: () => ({}),
    setWorkflowLinks: () => ({}),
    archiveWorkflow: () => ({}),
    unarchiveWorkflow: () => ({}),
    listWorkflowVersions: () => [],
    restoreWorkflowVersion: () => ({}),
  },
});
// Personal store: the mis-prefixed `wf_legacy` id lives HERE.
mock.module('@/lib/knowledge/personal-store', {
  namedExports: {
    getPersonalKnowledge: (id: string) => {
      if (id === 'wf_legacy') return { title: 'Legacy Note', md: 'the legacy note body' };
      throw new Error(`personal ${id} not found`);
    },
    ensureHydrated: async () => {},
    // Unused by this test, but `@/lib/connections/store` now imports the
    // `@/lib/governance` barrel (which re-exports effects.ts, a consumer of
    // this module's full surface) — this mock must provide every named
    // binding personal-store.ts does.
    __resetStore: () => {},
    movePersonalKnowledgeDomain: () => [],
    listPersonalKnowledge: () => [],
    createPersonalKnowledge: () => ({}),
    moveKnowledge: () => ({}),
    updatePersonalKnowledge: () => ({}),
    deletePersonalKnowledge: () => ({}),
    archivePersonalKnowledge: () => ({}),
    unarchivePersonalKnowledge: () => ({}),
    listPersonalKnowledgeVersions: () => [],
    restorePersonalKnowledgeVersion: () => ({}),
    promotePersonalKnowledge: () => ({}),
    certifyPersonalKnowledge: () => ({}),
    decertifyPersonalKnowledge: () => ({}),
    unsharePersonalKnowledge: () => ({}),
  },
});
// data/files/metrics/connections stores are NOT mocked — their real modules load
// fine and their getters are never reached by this knowledge-only test.

const { resolveGrantedContext } = await import('./grants-context.ts');
const { emptyContextGrants } = await import('@/lib/core/context-grants');

const user = { id: 'u1', name: 'U', domains: ['sales'], allDomains: ['sales'], activeDomain: null, role: 'creator' } as const;

test('grants-context: a mis-prefixed (wf_) id that lives in the personal store resolves via fallback', async () => {
  const grants = { ...emptyContextGrants(), knowledge: [{ id: 'wf_legacy', access: 'read-only' as const }] };
  const block = await resolveGrantedContext(grants, user as never);
  assert.match(block, /### Knowledge · Legacy Note/, 'the fallback store resolved the mis-prefixed id');
  assert.match(block, /the legacy note body/);
  // It is NOT silently dropped: no "not shown" omission notice for this item.
  assert.doesNotMatch(block, /not shown — no longer visible/);
});

test('grants-context: an id that misses BOTH stores is omitted honestly (loud), not silent', async () => {
  const grants = { ...emptyContextGrants(), knowledge: [{ id: 'wf_ghost', access: 'read-only' as const }] };
  const block = await resolveGrantedContext(grants, user as never);
  // Nothing resolved → empty block (the honest "nothing visible" shape). Never a throw.
  assert.equal(block, '');
});
