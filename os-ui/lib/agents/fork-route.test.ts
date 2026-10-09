/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 Borek Data Ventures UG (haftungsbeschränkt)
 */
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Role } from '../core/session.ts';

/** Behaviour of POST /api/agents/systems/[id]/fork — install a Marketplace system as an own copy. */

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

const { __resetStore, createSystem, promoteSystem, __recordFor } = await import('./store.ts');

beforeEach(() => { __resetStore(); USER = null; });

const ARYA: U = { id: 'arya', name: 'Arya', domains: ['sales'], role: 'admin' };
const KENJI: U = { id: 'kenji', name: 'Kenji', domains: ['finance'], role: 'builder' };
const CARA: U = { id: 'cara', name: 'Cara', domains: ['sales'], role: 'creator' };

/** Personal → Shared → Marketplace through the governed ladder (Admin can do both rungs). */
function marketplaceSystem() {
  const s = createSystem(ARYA, { name: 'Template' });
  promoteSystem(s.id, ARYA);
  promoteSystem(s.id, ARYA);
  return s;
}

async function fork(id: string) {
  const r = await import(`../../app/api/agents/systems/[id]/fork/route.ts?${Math.random()}`);
  return r.POST(new Request(`http://x/api/agents/systems/${id}/fork`, { method: 'POST' }), { params: Promise.resolve({ id }) });
}

test('401 when signed out', async () => {
  assert.equal((await fork('sys_x')).status, 401);
});

test('404 for an unknown system', async () => {
  USER = KENJI;
  const res = await fork('sys_nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'System not found' });
});

test('400 when the source is not on the Marketplace', async () => {
  const s = createSystem(ARYA, { name: 'Private' });
  USER = ARYA;
  const res = await fork(s.id);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Only Marketplace systems can be installed' });
});

test('403 for a Creator (install is Builder+)', async () => {
  const s = marketplaceSystem();
  USER = CARA;
  const res = await fork(s.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Installing a Marketplace agent template requires a Builder or Admin' });
});

test('200 installs a Personal, forked copy owned by the caller', async () => {
  const s = marketplaceSystem();
  USER = KENJI;
  const res = await fork(s.id);
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: string };
  assert.notEqual(id, s.id);
  const rec = __recordFor(id)!;
  assert.equal(rec.owner, 'kenji');
  assert.equal(rec.domain, 'finance');
  assert.equal(rec.visibility, 'Personal');
  assert.equal(rec.origin, 'forked');
  assert.equal(rec.sourceId, s.id);
  assert.equal(rec.yaml, __recordFor(s.id)!.yaml);
});
