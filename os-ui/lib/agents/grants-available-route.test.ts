/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/**
 * Behaviour of GET /api/agents/systems/[id]/grants/available?kind=… — the grant
 * picker's feed. Every store is REAL (nothing but the session is mocked): the point
 * is that each kind reuses the tab's own canView-scoped list, so the caller sees
 * their own items and never another user's Personal ones.
 */

// Offline: the stores' durable mirrors fall back to in-memory when fetch fails.
globalThis.fetch = (() => Promise.reject(new Error('offline-stub'))) as typeof fetch;

type U = { id: string; name: string; domains: string[]; role: Role };

// Session mock: USER=null → requireUser THROWS a 401-tagged error, exactly like the
// real gate (withRoute reads the error's `status`).
let USER: U | null = null;
mock.module('@/lib/core/auth', {
  namedExports: {
    requireUser: async () => {
      if (!USER) {
        const e = new Error('Not authenticated') as Error & { status?: number };
        e.status = 401;
        throw e;
      }
      return USER;
    },
  },
});

const { __resetStore, createSystem } = await import('./store.ts');
const { createDataset } = await import('../experimental/data/store.ts');
const { createPersonalKnowledge } = await import('../experimental/knowledge/personal-store.ts');
const { createFile } = await import('../experimental/files/store.ts');
const { createBet } = await import('../experimental/bigbets/store.ts');
const { createPillar } = await import('../experimental/strategy/pillars.ts');

const SARA: U = { id: 'sara', name: 'Sara', domains: ['sales'], role: 'builder' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['finance'], role: 'builder' };

beforeEach(() => { __resetStore(); USER = null; });

type Item = { id: string; name: string; scope: string; folder?: string; layers?: string[] };
type Body = { items: Item[]; folders?: { path: string; scope: string }[]; error?: string };

async function available(id: string, kind: string | null) {
  const r = await import(`../../app/api/agents/systems/[id]/grants/available/route.ts?${Math.random()}`);
  const qs = kind === null ? '' : `?kind=${encodeURIComponent(kind)}`;
  return r.GET(new Request(`http://x/api/agents/systems/${id}/grants/available${qs}`), { params: Promise.resolve({ id }) });
}

/** A system Sara owns, so the view gate passes. */
function sarasSystem() {
  return createSystem(SARA, { name: 'Desk' }).id;
}

async function itemsFor(kind: string): Promise<Body> {
  USER = SARA;
  const res = await available(sarasSystem(), kind);
  assert.equal(res.status, 200, `kind=${kind}`);
  return (await res.json()) as Body;
}

test('401 when signed out', async () => {
  assert.equal((await available('sys_x', 'data')).status, 401);
});

test('404 for an unknown system', async () => {
  USER = SARA;
  assert.equal((await available('sys_nope', 'data')).status, 404);
});

test('403 for a system the caller cannot view (checked before the kind)', async () => {
  const id = createSystem(KENJI, { name: 'Kenji bot' }).id;
  USER = SARA;
  assert.equal((await available(id, 'data')).status, 403);
});

test('400 for a missing or unknown kind', async () => {
  USER = SARA;
  const id = sarasSystem();
  for (const kind of [null, 'bogus']) {
    const res = await available(id, kind);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as Body).error!, /^kind must be one of: data, knowledge, files, /);
  }
});

test('data: own dataset listed as personal with layers + folder; another user\'s Personal hidden; folders returned', async () => {
  const mine = createDataset(SARA, { name: 'sara-orders' });
  const theirs = createDataset(KENJI, { name: 'kenji-ledger' });
  const body = await itemsFor('data');
  const item = body.items.find((i) => i.id === mine.id);
  assert.ok(item);
  assert.equal(item.scope, 'personal');
  assert.ok(Array.isArray(item.layers));
  assert.equal(typeof item.folder, 'string');
  assert.ok(!body.items.some((i) => i.id === theirs.id));
  assert.ok(Array.isArray(body.folders));
});

test('knowledge: own note listed; another user\'s Personal note hidden', async () => {
  const mine = createPersonalKnowledge(SARA, { title: 'Sara note', md: 'x', folder: '/plays' });
  const theirs = createPersonalKnowledge(KENJI, { title: 'Kenji note', md: 'y' });
  const body = await itemsFor('knowledge');
  const item = body.items.find((i) => i.id === mine.id);
  assert.equal(item?.scope, 'personal');
  assert.equal(item?.folder, '/plays');
  assert.ok(!body.items.some((i) => i.id === theirs.id));
  assert.ok(body.folders?.some((f) => f.path === '/plays' && f.scope === 'personal'), 'implicit folder synthesized from the item');
});

test('files: own file listed with its folder; another user\'s Personal file hidden', async () => {
  const mine = createFile(SARA, { name: 'sara.md', folder: '/reports', text: 'hello' });
  const theirs = createFile(KENJI, { name: 'kenji.md', text: 'secret' });
  const body = await itemsFor('files');
  const item = body.items.find((i) => i.id === mine.id);
  assert.equal(item?.scope, 'personal');
  assert.equal(item?.folder, '/reports');
  assert.ok(!body.items.some((i) => i.id === theirs.id));
  assert.ok(body.folders?.some((f) => f.path === '/reports'));
});

test('big-bets: own bet → bigbet:<id> as personal; another domain\'s bet hidden', async () => {
  const problem = { who: 'Ops', need: 'automate', obstacle: '', impact: '' };
  const mine = createBet(SARA, { name: 'Sara bet', problem, pillarId: 'pillar_onboarding', targetValue: 1, goLive: '2026-12-31' });
  const theirs = createBet(KENJI, { name: 'Kenji bet', problem, pillarId: 'pillar_onboarding', targetValue: 1, goLive: '2026-12-31' });
  const body = await itemsFor('big-bets');
  const item = body.items.find((i) => i.id === `bigbet:${mine.id}`);
  assert.equal(item?.scope, 'personal');
  assert.ok(!body.items.some((i) => i.id === `bigbet:${theirs.id}`));
  assert.equal(body.folders, undefined, 'plan kinds carry no folder tree');
});

test('strategy: own personal pillar → pillar:<id> as personal; another user\'s personal pillar hidden', async () => {
  const mine = await createPillar(SARA as never, { name: 'Sara pillar', scope: 'personal' });
  const theirs = await createPillar(KENJI as never, { name: 'Kenji pillar', scope: 'personal' });
  const body = await itemsFor('strategy');
  assert.equal(body.items.find((i) => i.id === `pillar:${mine.id}`)?.scope, 'personal');
  assert.ok(!body.items.some((i) => i.id === `pillar:${theirs.id}`));
});

test('operating-manual: the manual scopes the caller may view, as manual:<scope>', async () => {
  const body = await itemsFor('operating-manual');
  const ids = body.items.map((i) => i.id);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.match(id, /^manual:(my|domain|company)$/);
  assert.ok(ids.includes('manual:my'), 'everyone can view their own manual');
});

test('metric, connection and connections: 200 with an items array', async () => {
  for (const kind of ['metric', 'connection', 'connections']) {
    const body = await itemsFor(kind);
    assert.ok(Array.isArray(body.items), kind);
    assert.equal(body.folders, undefined, `${kind} is not foldered`);
  }
});
